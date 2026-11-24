# Metadata Cache Service Spec

**Status:** draft, 2026-11-24. Reviewed twice against the code: in full, then concurrency, fingerprint, `apiVersion` and failure accounting. Both reviews' findings are worked in. Target: Queryeer 0.24 (`feature/api-0.24.0`).

## Why

The JDBC plugin keeps a persisted, self-refreshing schema cache: a background loop, a crawl policy driven by usage, and H2 files per connection. Navigation, completion and the assistant read from it, so they never wait for the database, and the data survives restarts.

External plugins for non-SQL sources need the same thing and have none of it:

| Plugin | What it lists today | Cost | Where it's cached |
|---|---|---|---|
| MongoDB | databases, collections, indexes, fields sampled from up to 1,000 documents, distinct values | Sampling is slow (up to 10 s a collection) | In the frontend's memory (`MongoExplorer.tsx`): lost on restart, cold for every new session |
| Elasticsearch | aliases, data streams, indices; later mappings for field completion | Cheap per index, adds up on clusters with thousands of indices | In the catalog panel's memory |
| Kafka | topics | Cheap | In the catalog panel's memory |

Each plugin would otherwise build a loop, a policy, health and backoff, vault handling, H2 storage and recovery of its own.

## Goal

A core backend service that stores and refreshes a plugin's metadata as a tree of named nodes. The plugin supplies:

- its connection ids;
- a function that crawls one level of one connection.

Core owns everything else: the schedule, storage, health, the vault, the actions its frontend calls, status, and a bottom panel where every plugin's crawls are managed.

### Not goals

- **Moving JDBC onto it in 0.24.** JDBC's store also models references (foreign keys, semantic links) and table lookup by normalised name. Those stay JDBC's. See [Phase 4](#phases).
- **Caching data.** The cache holds names, kinds and types. Document values, distinct values and message contents never go in it (see [Data rule](#data-rule)).
- **A query language over the cache, or search across plugins.** Readers get subtrees. Searching them is the plugin's business (see [Decisions](#decisions), 4).
- **A general event channel from plugin backends to their frontends.** Only this service's change events reach plugin frontends (see [Decisions](#decisions), 1).

## What comes from JDBC, and what is new

JDBC's cache is a single-threaded loop with no timeouts and no shutdown. A shared service needs more, so **phase 1 is mostly new code**, reusing JDBC's tested pieces where they fit:

| Piece | From JDBC | New |
|---|---|---|
| Usage throttling (30 s), `refreshNow`/`refreshDue`, ±10% deterministic jitter | Reused | |
| Usage score: +0.3 per use, 7-day half-life | Reused | |
| Interval tiers: root 2 min; levels by score ≥0.8 → 5 min, ≥0.5 → 1 h, ≥0.2 → 6 h, else 1 day; ×2…×16 backoff capped at 7 days | Reused as defaults | Backoff per level, also for the root |
| Health: 2 failures → 60 s cooldown (`JdbcConnectionHealth`) | Threshold reused | Counts only root failures; unhealthy until the root's next attempt (see [Vault and health](#vault-and-health)) |
| H2 open with a 10 s timeout, corrupt-file recovery, 100 MB reset, `SHUTDOWN COMPACT` when a file is over 20 MB after a persist | Limits reused | Restructured: file operations become writer tasks, reads use `IFEXISTS=TRUE`, failed deletes are reported, a late connection is closed (see [Concurrency](#concurrency)) |
| Loop | JDBC's ticks every 5 min by default, so its "2 min" root is really ~5 min | A 10 s tick that crawls whatever is due |
| Parallel crawls, crawl timeouts, interrupts, abandoned threads, shutdown on deactivate | None | All new |
| Per-level errors | None: `crawl_run` is only ever finished as `SUCCESS`, so JDBC's `lastError` is always empty | New, stored per level |
| Pause | None: `enabled` is never set to false, and the panel's toggle is a TODO. A disabled level would get interval zero, i.e. be crawled every tick | New, per connection |
| Model: database/schema/table/column, `object_reference`, table lookups | Stays in JDBC | |
| Scopes: JDBC's TOP / DEEP keyed by database, two files per connection with sanitised names | | **Levels keyed by a path**, one file per connection with a hashed name |

H2 becomes a dependency of the backend runtime, not of any plugin (today it's the JDBC plugin's; backend-core has it only for tests). Plugins see only `backend-api` types, and no plugin bundles H2.

## Model

```java
/** A node of a plugin's metadata: a database, collection, index, topic, field... Structure only, never data: see the data rule. */
public record MetadataNode(String name, String kind, Map<String, Object> attributes, List<MetadataNode> children, boolean crawlable)
```

- **`name`** is unique among its siblings and case-sensitive (MongoDB and Elasticsearch are). Any characters are allowed, including `.` and `/`.
- **`kind`** is the plugin's own vocabulary, such as `database`, `collection`, `view`, `index`, `alias`, `dataStream`, `topic` or `field`. Core never interprets it.
- **`attributes`** are plain JSON values: strings, numbers, booleans, lists and maps. Examples are a field's types and how often it was seen in the sample, an index's document count, or a topic's partitions. They're stored as JSON.
- **`crawlable`** marks a node whose children come from a crawl of its own: a collection's fields or an index's mapping. Its `children` are then empty in the crawl that returned it, and the store keeps the children from the node's last own crawl.

**A path** names a node from the root: `["sales", "orders"]` is the collection `orders` in database `sales`. The empty path is the root level. Paths are lists of names everywhere: in the API, the actions, the protocol, and the store's keys (see [Storage](#storage)). Only the panel shows them joined, as `sales / orders`.

**A level** is what one crawl returns: the root level, or the children of one crawlable node. Levels are stored, scheduled and reported separately. This generalises JDBC's TOP (the root) and DEEP (keyed by database) to any depth.

Examples:

| Plugin | Root level | Crawlable node | Its level |
|---|---|---|---|
| MongoDB | databases with their collections and views | `[db, collection]` | sampled fields (path, types, frequency) and indexes |
| Elasticsearch | aliases, data streams, indices (hidden ones left out) | `[index]` | mapping fields (path, type) |
| Kafka | topics with partition counts | none in v1 | |

## Backend API (`backend-api`, since 0.24.0)

One cache per plugin. A plugin with metadata of several unrelated sources can model them as subtrees of its root.

```java
public interface BackendPluginContext
{
    /**
     * This plugin's metadata cache. @since 0.24.0
     *
     * The default throws: a context that isn't a plugin's own, e.g. a test's, has none.
     */
    default MetadataCacheRegistry metadataCache()
    {
        throw new UnsupportedOperationException("A metadata cache belongs to a plugin: register it from the context a plugin gets in activate");
    }
}

public interface MetadataCacheRegistry
{
    /**
     * Registers the plugin's cache, starts its background crawls, and registers its frontend actions. Throws
     * IllegalStateException when called twice. When the plugin deactivates, the cache closes before the plugin's own
     * deactivate runs: crawls are interrupted, pending writes finish, files close. So a crawler may use clients the
     * plugin closes in deactivate.
     */
    MetadataCache register(MetadataCrawler crawler, MetadataCachePolicy policy);
}

public interface MetadataCrawler
{
    /**
     * The version of the nodes this crawler returns. Raise it when their shape changes (new kinds, renamed attributes):
     * a stored cache with another version is deleted on register, and crawled again.
     */
    int formatVersion();

    /** The connections to keep fresh. Read every tick; see Storage for ids that disappear. */
    List<String> connectionIds();

    /** The connection's name in the Metadata panel. */
    default String connectionTitle(String connectionId)
    {
        return connectionId;
    }

    /**
     * What the cache's contents depend on, e.g. a hash of the endpoint and username. Read every tick, so it's cheap and
     * never touches the vault or the network. When it differs from the stored one, the connection's cache is reset and
     * crawled again, so a changed endpoint never shows the old cluster's collections, with no settings listener in the
     * plugin. Null, or an exception, means "unknown": nothing is compared or stored, and the cache is kept. The fingerprint
     * is stored with each crawl's result, as read just before that crawl started. Changing it resets the cache, but
     * keeps the connection's pause.
     */
    default String connectionFingerprint(String connectionId)
    {
        return null;
    }

    /**
     * Crawls one level: the root for an empty path, else the children of the crawlable node at {@code path}. Runs on a core
     * thread whose context class loader is the plugin's, never more than once at a time for the same connection and
     * level. Stops when the thread is interrupted (the crawl timed out, or the plugin deactivates). Throws
     * SecuritySessionClosedException when a secret needs the locked vault (see Vault and health). How much to sample
     * (documents, time per query) is the crawler's choice; core only bounds the whole crawl (policy).
     */
    List<MetadataNode> crawl(String connectionId, List<String> path) throws Exception;
}

public record MetadataCachePolicy(
        Duration rootInterval,              // default 2 min
        List<UsageTier> levelIntervals,     // default JDBC's four tiers, see above
        Duration crawlTimeout,              // default 60 s, one crawl of one level
        int maxNodesPerCrawl,               // default 20,000, counted over the returned subtree
        int maxParallelCrawls)              // per plugin, default 2
{
    public record UsageTier(double minScore, Duration interval) {}

    public static MetadataCachePolicy defaults() { ... }
}

public interface MetadataCache
{
    /** The stored level at path with its subtree up to depth (1 = only the level), or empty when never crawled. Never crawls, and doesn't count as use. */
    Optional<MetadataSnapshot> snapshot(String connectionId, List<String> path, int depth);

    /** Records that the user used this level, e.g. a query ran on the collection. Throttled; crawls it in the background when due. */
    void recordUsage(String connectionId, List<String> path);

    /** Crawls now, also on a paused connection. With wait, returns the new snapshot; without, returns at once. */
    Optional<MetadataSnapshot> refresh(String connectionId, List<String> path, boolean wait);

    /** Forgets a connection's cache. The next tick crawls it again. Rarely needed: see connectionFingerprint. */
    void invalidate(String connectionId);
}

public record MetadataSnapshot(List<MetadataNode> nodes, long revision, Instant crawledAt, MetadataLevelStatus status)
{
}
```

- **Only levels in use get refreshed.** Every tick keeps each connection's root level fresh. Below the root, only levels with a usage score are refreshed: those given to `recordUsage`, `metadata.usage`, or a `metadata.snapshot` with `crawlIfMissing` (an explicit expand). Reading a snapshot doesn't count, so completion that reads every collection's fields doesn't make every collection hot. A MongoDB cluster with 2,000 collections then samples only the few the user works with.
- **The plugin backend reads the cache too.** For example, payloadbuilder's catalog completion can read field names without a crawl.
- **Register before extensions.** A plugin registers its cache early in `activate`, and hands it to its `DependencyExtension` (e.g. the payloadbuilder catalog) as part of the extension's state.

### Bounds on a crawl

- **Time:** a crawl running longer than `crawlTimeout` is interrupted and counted as a failure ("timed out after 60 s"). Its slot is freed at once, and whatever it returns later is discarded. That level isn't crawled again until the crawl's thread ends.
- **Abandoned threads:** a connection with a crawl thread that ignored an interrupt is marked "not responding". It gets no background crawls until that thread ends, while the plugin's other connections keep crawling. A level is never recrawled while its own previous thread runs, so abandoned threads can't outnumber levels. The panel shows "not responding" on the connection. Crawlers must set I/O timeouts shorter than `crawlTimeout`, for example MongoDB's `socketTimeoutMS`, whose default 0 means never. `DEVELOPMENT-PLUGIN.md` says so.
- **Explicit crawls go first:** a crawl the user asked for (`crawlIfMissing`, a refresh) is never queued behind background crawls. One of the `maxParallelCrawls` slots is kept for them, so a waiting call ends within `crawlTimeout` and fits in `METADATA_CRAWL_WAIT_MS`.
- **Size:** when a crawl returns more than `maxNodesPerCrawl` nodes, counted over the whole returned subtree, the store keeps the first nodes in the order returned, breadth first, up to the limit. The level's status gets `truncated: true`, the panel shows "cut off at 20,000 nodes", and the crawl counts as a success. A crawler that can rank (most frequent fields first) should return nodes in that order. A truncated crawl never marks nodes deleted (see [Storage](#storage)).

### Requiring 0.24

Compatibility fields such as `frontend.apiVersion` aren't enforced at discovery (DEVELOPMENT-PLUGIN §3), so declaring them doesn't stop a plugin from loading on 0.23. On 0.23:

- the backend fails as soon as it loads a class that implements `MetadataCrawler`, with `NoClassDefFoundError`, because `com.queryeer.backend.api` loads from the host first;
- the frontend's `context.metadataCache` is undefined.

The documented way to require a Queryeer version is a range on a required built-in dependency (§3.3). The MongoDB, Elasticsearch and Kafka plugins have none: payloadbuilder is optional for them, and an optional range never skips a plugin. Built-in backend plugins are only the query engines (`queryengine.jdbc`, `queryengine.payloadbuilder`, `queryengine.sql.parser`...), and depending on one of those just for its version would be wrong. So:

- **On 0.23,** a plugin that uses the cache loads and fails in `activate` with `NoClassDefFoundError`, shown in its runtime status and in Observability. Its README says "needs Queryeer 0.24", as the plugins already say "needs 0.23". That's accepted for this one release.
- **From 0.24, core enforces `apiVersion`** at discovery, for `frontend.apiVersion` and a new `backend.apiVersion`. Later requirements then skip cleanly instead of failing in `activate`.
  - **The backend decides, and the frontend follows.** Today the frontend scans plugin folders on its own and checks no versions. A plugin the backend skips may still load its frontend; `plugin-status-notifications.ts` says so. The two also read different versions: the app's `package.json` says 0.23.0 while the backend is 0.24.0-SNAPSHOT. So the backend checks both fields against its own version, with the development-build relaxation of §3.3, and reports each plugin's verdict in `backend.runtimeStatus`. The frontend doesn't activate a plugin the backend skipped, whichever field failed. The reason shown is "Needs Queryeer <range>, but <version> is running".
  - **Lower bound first.** The guide (DEVELOPMENT-PLUGIN.md §2) tells authors to declare `^0.<minor>.0`, which for 0.x excludes the next minor. Enforcing that would skip every such plugin on each release. So the guide changes to `>=0.<minor>.0 <1.0.0`, as this repo's plugins already declare. 0.24 enforces only the lower bound, and a failed upper bound is a warning. Full enforcement comes no earlier than one release after the guide changes.
  - **The manifest schema** gets `backend.apiVersion`: `plugin.json.schema.v1.json`'s `backend` object has `additionalProperties: false`. 0.23 tolerates the field, because its manifest mapper ignores unknown keys.

A plugin that also wants to run on older versions without the cache must:

- load its crawler class by name, only after checking that the context has the method;
- check `if (context.metadataCache)` in the frontend, as plugins check `context.backend` for 0.23.

## Frontend actions

`register` adds these actions to the plugin's own `PluginActionRegistry`, so the frontend calls them with `context.backend.invoke`:

| Action | Payload | Result |
|---|---|---|
| `metadata.snapshot` | `{ connectionId, path?, depth?, crawlIfMissing? }` | `{ nodes, revision, crawledAt, status } \| null`. With `crawlIfMissing`, a level never crawled is crawled first and gets a usage score, which is what a first expand in a tree wants |
| `metadata.refresh` | `{ connectionId, path?, wait? }` | as `snapshot` when `wait`, else `null` |
| `metadata.usage` | `{ connectionId, path }` | `null` |
| `metadata.status` | `{ connectionId? }` | `MetadataLevelStatus[]` |

- **Reserved prefix:** the `metadata.` prefix is reserved from 0.24. `PluginActionRegistry.register` rejects it with `IllegalArgumentException`, and the 0.24 Javadoc says so. Core registers these actions through its own internal path, not that method.
- **Waiting for a crawl:** `invoke` gives up after 10 s by default, which is shorter than a crawl may take. A call that crawls (`crawlIfMissing`, or `refresh` with `wait`) passes `{ timeoutMs: METADATA_CRAWL_WAIT_MS }`. That constant is exported by `@queryeer/api` and equals the default `crawlTimeout` plus 15 s. Alternatively a view calls without waiting and updates from `onChanged`.
- **A locked vault:** the crawling calls ask the user to unlock it (see [Vault and health](#vault-and-health)).

`MetadataLevelStatus` replaces JDBC's `JdbcSchemaCrawlStatus` with generic names:

```
{ connectionId, path, state, lastSuccessAt, lastAttemptAt, lastFailureAt, nextDueAt, consecutiveFailures, usageScore, nodeCount, truncated, revision, lastError }
```

`state` is one of `fresh`, `due`, `crawling`, `failed`, `vaultLocked`, `unhealthy` or `paused`. Pausing applies to the whole connection, so every level of a paused connection reports `paused`.

**Change events.** The frontend context gets `context.metadataCache.onChanged(listener): Disposable` (since 0.24.0). It receives the `metadataCache.changed` notifications (see [The Metadata panel](#the-metadata-panel)) for the plugin's own cache only, without `pluginId`. So an explorer or a completion list updates when a background crawl finishes, without polling. It calls the listener with `{ connectionId, path, revision, status }`.

`@queryeer/api` gets `plugin/MetadataCache.ts` with:

- the action names, their payload and result types, and `METADATA_CRAWL_WAIT_MS`;
- `MetadataNode` and `MetadataLevelStatus`;
- the event type.

So plugins don't redeclare them.

## Storage

- **Location:** `<appDir>/metadata-cache/<pluginId>/<sha256(connectionId)>.mv.db`, overridable with `queryeer.metadataCache.dir`. One file per connection. Ids are hashed because they're user-defined.
- **Tables:**
  - `meta`: format version, connection id (in clear, so the panel can list a file whose plugin isn't active), fingerprint, paused. When the connection was last seen in `connectionIds()` is kept in memory, not here: writing it every tick would churn the file;
  - `node`: path key, parent path key, name, kind, `attributes_json`, crawlable, `last_seen_run`, deleted;
  - `level_state`: path key, usage score, last used, failures, next due, revision, truncated, last error, last failure time;
  - `crawl_run`.
- **Path keys** are the path as a JSON array: `["sales","orders"]`. The root level's key is `[]`. They are exact and case-sensitive, so names containing `.` or `/` need no escaping.
- **A complete crawl replaces its level:** the level's nodes not returned are marked deleted. Children of a crawlable node stay until that node's own level is crawled again.
- **A disappeared node** takes its subtree with it: the nodes below it, and the `level_state` of every level under it. So the loop stops crawling a dropped collection, instead of failing on it and making the connection unhealthy.
- **A truncated crawl** only adds and updates. It never marks nodes deleted, because a node past the limit isn't known to be gone. The level is replaced on its next complete crawl.
- **Resets:** the next tick crawls the connection again after any of them.
  - **These empty the file and keep its pause** (see [Concurrency](#concurrency)):
    - a different format version, when the cache is registered;
    - a different fingerprint, on any tick.
  - **These delete the file**, as JDBC does today, and lose the pause:
    - a corrupt file;
    - a file over 100 MB.
- **Compaction:** files are compacted after a persist when they're over 20 MB, as JDBC does today.
- **Removed connections:** an id that has been missing from `connectionIds()` for 10 minutes has its file deleted. That's a grace period, so a settings save racing a tick doesn't wipe a connection. The clock starts at the first tick after a start, so a restart never removes anything at once.
- **Uninstalled plugins:** the Plugin Manager's uninstall deletes the plugin's `<pluginId>` folder. Core never infers an uninstall from a plugin being absent at startup. Safe mode, development folders, disabled plugins and failed discovery all make a plugin absent without it being uninstalled. Folders of plugins that aren't installed any more (e.g. one removed by hand) show in the panel as "unknown plugin", with Clear.

## Concurrency

Several crawls of one connection run at once (different levels), and files get reset and compacted. H2's `SHUTDOWN COMPACT` closes the database under every other open session. Windows can't delete an open file. In H2 2.3, an interrupt during file I/O closes the file channel and the store with it. JDBC's store can't be reused as is: it compacts inside `persistSnapshot`, recovers inside `open()`, and deletes files there without a lock, swallowing failures. So:

- **No H2 call ever runs on a thread that can be interrupted.** That includes crawl threads, request-handler threads (the transport's `shutdownNow` interrupts them) and the plugin's threads. Every read and write runs on the store's own executor, whose threads are never interrupted. Callers only stop waiting for it. So a crawler that calls `cache.snapshot()` on its own thread is safe.
- **One writer per file.** Each file has a single queue on that executor. Writes run in order through it: persisting a crawl's result, `level_state` updates and recording usage. So do the file operations: reset, compact, recover, clear and removal. They're tasks on the same queue, so the writer never waits on itself. Compaction is a task queued after a persist, never part of it.
- **A per-file read/write lock.** The lock is fair. Each read holds it shared for its whole H2 session. A file operation takes it exclusively, so it waits for current reads and holds off new ones until it's done.
- **Generations.** A file operation that invalidates contents raises the file's generation first, before it queues: reset, clear, removal. Each crawl records the generation when it starts. The writer compares that generation inside its own task, and discards the result when it differs. A crawl that finishes between the raise and the operation is therefore discarded too.
- **Opening never creates a file by accident.** Reads open with `IFEXISTS=TRUE`. A missing file is simply "never crawled". Only the writer creates files, and it writes `meta` in the same task.
- **Resets truncate, they don't delete.** A format or fingerprint reset truncates `node`, `level_state` and `crawl_run` inside the exclusive lock, and keeps `meta.paused`. Only corruption, the 100 MB cap and removal delete the file. A delete that fails (Windows) renames the file to `*.stale` for deletion at the next start. If the rename fails too, the error goes in the panel and the log, and nothing retries every tick.
- **A connection that opens late is closed.** When opening times out (10 s), a connection that opens after the timeout is closed as soon as it arrives. JDBC's `connectWithTimeout` leaks it and keeps the file locked.

## Data rule

The cache is written to disk unencrypted and may sit there for weeks. Nodes and attributes carry structure only: names, kinds, types, counts and sizes. Document values, distinct values, sample messages and anything taken from a field's contents stay out of it. MongoDB's value suggestions remain an in-memory frontend cache. The `MetadataNode` Javadoc says so, and `DEVELOPMENT-PLUGIN.md` repeats it.

**Field names can be data.** A document keyed by user id or date (`{ "u_48213": {...}, "u_48214": {...} }`) makes values into field names. A crawler collapses such objects: past a limit of distinct keys, it records the object as one node of kind `dynamicKeys`, with the key count and the value types, but not the keys. MongoDB's sampler already stops listing an object's children at 200 (`FIELD_SAMPLE_MAX_CHILDREN`) and uses that as its limit.

Connection ids are hashed in file names, and kept in clear in the `meta` table. Names of databases, collections and indices are stored in clear, as JDBC's are today.

## Vault and health

- **A locked vault in the background:** a background crawl that needs a secret while the vault is locked throws `SecuritySessionClosedException`. The level is skipped silently, its failure count doesn't grow, and its state is `vaultLocked`.
  - The coordinator looks for that exception anywhere in the cause chain, because a crawl's exception arrives wrapped in an `ExecutionException`, and plugin code may wrap it further. It checks before treating anything as a failure. In JDBC this works only because `resolve` runs outside the `try` that catches `RuntimeException`.
  - `Events.SECURITY_SESSION_OPENED` makes every `vaultLocked` level due at once, and runs the next tick immediately.
- **A locked vault when the user asked:** `crawlIfMissing`, `refresh` with `wait`, and the panel's Refresh let the exception through. `invoke` then asks the user to unlock the vault and calls again, as for any plugin action.
- **Failures are per level.** A level that fails backs off on its own (×2…×16). So one collection that keeps timing out never stops the root or the other collections.
- **Health:** only failures of the root level count toward the connection's health.
  - After 2 root failures in a row, the connection is unhealthy until the root's next attempt (its backed-off `nextDueAt`). Only a root success makes it healthy again. While it's unhealthy, no other level of it is crawled in the background. This is not JDBC's 60 s cooldown. JDBC forgets the failures once the cooldown ends, so with root backoff a dead server's hot levels would fail through most of each gap.
  - An explicit refresh still runs on an unhealthy connection, so the user sees the error.
- **Errors:** a failed crawl keeps the previous snapshot and records the error and its time in the level's `level_state`. `snapshot` returns the stale nodes with that status, so a view can show "couldn't refresh: …" above the old data instead of an empty tree.

## The Metadata panel

A core bottom panel, a tab next to Console registered with `context.layout.registerPanel`. It lists every crawl of every plugin in one place, and is where crawls are managed. It is modelled on JDBC's "Schema Cache" subtab (`JdbcSchemaCachePanel.tsx`), which it replaces in phase 4.

- **Grouped by plugin, then by connection**, with the connection's title (`MetadataCrawler.connectionTitle`). It expands into the connection's levels: the root, then each crawled path, e.g. `sales / orders`.
- **Columns, per level:** nodes, last success, next due, failures, usage, and the state. A truncated level shows "cut off at N nodes".
- **A failed level** shows its error inline, with the time of the last attempt.
- **Actions:**
  - **Refresh**, per level, per connection (the root and every level with a usage score) and for all;
  - **Clear**, per connection: deletes its file, and the next tick crawls it again;
  - **Pause and resume**, per connection, for a cluster that mustn't be sampled during the day. A paused connection gets no background crawls, also for levels crawled for the first time after the pause, and keeps its stored data. An explicit refresh still runs. Paused is stored in the file's `meta`, so it survives restarts and is cleared by Clear.
- **A crawl in progress** shows as a spinner on its row. Refresh is disabled on a row that is already crawling.
- **Connection rows** show "not responding" while a crawl thread of theirs ignores an interrupt.
- **Inactive plugins:**
  - caches of a disabled plugin, or one that failed to activate, are listed greyed out as "inactive";
  - a folder of a plugin that isn't installed is listed as "unknown plugin";
  - both have Clear as the only action, and their connection titles fall back to the id from `meta`.
- **A toolbar filter** narrows by plugin, connection or path text, and a toggle shows only failures.
- **Updates live while visible**, from the `metadataCache.changed` notification.

Core backs it with new protocol methods of its own, not with any plugin's actions. Core knows every registered cache, so this needs no plugin code:

| Method | Payload | Result |
|---|---|---|
| `metadataCache.list` | `{ pluginId?, connectionId? }` | `[{ pluginId, pluginTitle, active, connectionId, connectionTitle, paused, notResponding, levels: MetadataLevelStatus[] }]` |
| `metadataCache.refresh` | `{ pluginId, connectionId, path? }` | `null`; without `path`, the root and every level with a usage score |
| `metadataCache.clear` | `{ pluginId, connectionId }` | `null` |
| `metadataCache.setPaused` | `{ pluginId, connectionId, paused }` | `null` |

Live updates come from a new protocol notification, `metadataCache.changed` (BACKEND_PROTOCOL §6, alongside `queryengine.progress`). It carries `{ pluginId, connectionId, path, revision, status }`. It is sent when a crawl starts, finishes or fails, and on clear, pause and resume. The panel gets all of them, and each plugin frontend gets its own through `context.metadataCache.onChanged`.

The four methods and the notification go in the handshake's capability lists (BACKEND_PROTOCOL §5.1), so a frontend can tell a backend that has them.

## Testing a plugin

- **The crawler** is a plain function from a connection and a path to nodes. Plugins test it directly, against a container where they have one (as the Kafka, MongoDB and Elasticsearch plugins already do), with no cache involved.
- **Code that reads the cache** takes a `MetadataCache`, an interface of four methods, so a test passes a small fake. Core ships no test fixture in 0.24.
- **Frontend code** calls `context.backend.invoke` and `context.metadataCache.onChanged`, both of which a test stubs, as the plugins' tests already stub `invoke`.

## Phases

1. **Core 0.24:**
   - **the service:** the API, and the implementation as described in [What comes from JDBC, and what is new](#what-comes-from-jdbc-and-what-is-new). It's mostly new code: the scheduler, timeouts, the single writer and file locks, per-level errors, pause, and the fingerprint. JDBC keeps its own copy until phase 4;
   - **the plugin APIs:** the `@queryeer/api` types, `context.metadataCache.onChanged`, and §7.x in `DEVELOPMENT-PLUGIN.md`;
   - **the Metadata panel:** its `metadataCache.*` methods and the `metadataCache.changed` notification, with the contracts on both sides, the handshake capabilities and `BACKEND_PROTOCOL.md`;
   - **the Plugin Manager's uninstall** deletes the plugin's cache folder;
   - **`apiVersion` enforcement** at discovery (see [Requiring 0.24](#requiring-024)):
     - the backend checks both fields, and the frontend follows its verdict;
     - lower bound only in 0.24;
     - `backend.apiVersion` in the schema;
     - the guide changed to `>=0.<minor>.0 <1.0.0`, in `DEVELOPMENT-PLUGIN.md` §2 and §3;
   - **a test plugin** with a fake crawler;
   - **tests:**
     - the policy, and the tick with a fake clock;
     - path keys with `.`, `/` and case;
     - level replacement, crawlable children, and a vanished node's levels;
     - the timeout, including a crawler that ignores interrupts: its connection is "not responding" while others keep crawling;
     - an explicit refresh while every background slot is busy;
     - interrupting a thread that waits on a read, which mustn't close the store;
     - reads of a deleted file not recreating it;
     - a reset racing a persist and a crawl that finishes between the generation raise and the reset;
     - a reset keeping the pause;
     - a null or throwing fingerprint keeping the cache;
     - a vault-locked crawl wrapped in other exceptions, and those levels becoming due on unlock;
     - root-only health staying unhealthy until the root's next attempt;
     - `apiVersion`: lower bound skips in both frontend and backend, upper bound warns;
     - truncation without deletion;
     - the format and fingerprint resets, including a crawl of the old generation landing after a reset;
     - clear and compact while crawls run;
     - corrupt-file recovery;
     - the vault: skipped in the background, an unlock prompt for an explicit refresh;
     - per-level failures and root-only health;
     - pause, including levels new after the pause;
     - the removal grace period;
     - inactive and unknown plugins in `metadataCache.list`;
     - closing before the plugin's `deactivate`.
2. **MongoDB pilot** (the plugin then requires 0.24):
   - **levels:** the root holds databases and collections; level `[db, collection]` holds sampled fields (with `dynamicKeys` collapsing) and indexes;
   - **actions:** MongoDB's actions are query-engine actions (`MongoQueryEngineProvider.invoke`), not `PluginActionRegistry` ones. The explorer, `.mongo` completion and the catalog panel switch from engine `invoke` to `context.backend.invoke("metadata.*")`;
   - **replaced by the cache** and removed: `mongodb.databases`, `mongodb.collections`, `mongodb.indexes` and `mongodb.fields`. The frontend and backend ship in the same plugin ZIP, so no older frontend calls them;
   - **stay live:** `mongodb.values` (data, so never cached), `mongodb.documents`, `mongodb.validate`, `mongodb.ping` and `mongodb.testConnection`;
   - **backend wiring:** the cache is registered in `activate` before `whenDependencyActive`, and handed to the payloadbuilder catalog extension in its state along with the clients. The fingerprint is a hash of the connection's URI and username;
   - **running a query** calls `recordUsage` for the collections it touched, and `onChanged` refreshes open views;
   - **the in-memory caches** shrink to the value cache.
3. **Elasticsearch, then Kafka:**
   - **Elasticsearch:** the root holds aliases, data streams and indices (hidden ones left out). Level `[index]` holds mapping fields, which feed completion for `es#_doc` and the Query/Discover editors. `indices.list` is replaced by the root snapshot; `connection.test` stays live. The fingerprint covers the endpoint and username;
   - **Kafka:** the root holds topics, replacing `topics.list`.
4. **JDBC, optional:** JDBC's store becomes the generic store plus its reference and lookup tables, the coordinator and policy are deleted, and the JDBC panel's "Schema Cache" subtab is removed in favour of the Metadata panel. Only if phases 2 and 3 didn't change the API much.

## Decisions

Settled on 2026-11-24 with the recommended option. Each can be revisited before phase 1 starts.

1. **Change events for plugins: forward the cache's own events, no general channel.** `context.metadataCache.onChanged` receives the `metadataCache.changed` notification the panel already needs, filtered to the plugin, so it costs no extra protocol message. A general `context.backend.on(topic)` channel is a larger protocol design with its own questions (ordering, back-pressure, which plugin may send what), and nothing besides this needs it yet.
2. **One cache per plugin, no cache id.** Every planned plugin needs exactly one, and an id would run through the actions, methods, storage paths and panel for nothing. If a plugin ever needs two, an overload `register(String id, …)` can be added without breaking anyone: the existing cache becomes the default id.
3. **Core bounds the crawl, the crawler decides how to sample.** Core owns a time limit and a node limit per crawl (`crawlTimeout`, `maxNodesPerCrawl`). A hung or exploding crawl hurts every crawl slot of the plugin, and the store. How many documents to sample, and how long each query may run, depends on the source, so it stays the crawler's choice. MongoDB keeps its 1,000 documents and 10 s.
4. **The assistant stays per plugin.** In 0.24 it reads JDBC's snapshot as today. The assistant extension (`ASSISTANT_EXTENSION_SPEC.md`) is frontend-only. So a plugin that wants assistant tools over its cache registers them in its frontend, and they read the cache with `metadata.snapshot`. A search across plugins would need a shared idea of what a "table" is, which this tree deliberately doesn't have.
5. **The name is "metadata cache".** "Schema" fits SQL, but not Kafka topics or MongoDB's collections without a schema. It is used throughout: `MetadataCache` in the API, `metadata.*` actions, `metadataCache.*` protocol methods, and the panel's title "Metadata".
6. **Enforce `apiVersion` from 0.24 rather than add a dependency for the version.** The alternative was a built-in "host" plugin id that every plugin could put a range on. Enforcing the field plugins already declare is simpler and needs no manifest changes. The cost is one release where a too-new plugin fails in `activate` instead of being skipped. The guide's `^0.<minor>.0` advice changes to `>=0.<minor>.0 <1.0.0`, since enforcing `^` would skip every plugin on each minor release. Upper bounds are only warned about until a release after that change.
