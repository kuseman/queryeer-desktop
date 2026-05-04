# ConfigService Streamlining Plan — Backend Credential Resolution

**Status:** Implementation  
**Created:** 2026-05-04  
**Goal:** Eliminate all credential passing from frontend to backend. Backend resolves credentials from settings files via a central ConfigService.

---

## 1. Motivation

Currently, the frontend passes full connection credentials over STDIO on every `queryengine.execute` and `queryengine.invoke` call:

**Query execute (JDBC)** — `engineState` carries url, username, password, dialectId, properties:
```json
{ "jdbc": { "connection": { "connectionId": "...", "dialectId": "...", "url": "...", "username": "...", "password": { "secretRef": "..." }, "properties": {...} } } }
```

**Query execute (Payloadbuilder)** — `engineState` carries endpoint, authType, authUsername, authPassword:
```json
{ "payloadbuilder": { "catalogs": { "es1": { "catalogId": "elasticsearch", "properties": { "endpoint": "...", "authType": "BASIC", "authUsername": "...", "authPassword": { "secretRef": "..." } } } } } }
```

**Engine invoke** — JDBC schema fetch and ES listIndices payloads carry passwords, properties, auth alongside connectionId.

The backend already stores this data in settings files but has no generic mechanism to read them. The existing `ConfigService` is a trivial `Map<String,String>` backed by system properties.

---

## 2. Design Principles

1. **Minimal backend state** — Upsert on query. Don't hold per-file catalog config between requests.
2. **Frontend owns the information flow** — Sends everything needed EXCEPT credentials.
3. **Credentials are shared** via settings files on disk, resolved backend-side via ConfigService.
4. **No backward compatibility** — App not released. Clean break.

---

## 3. ConfigService Redesign

### 3.1 New Interface (`backend-api`)

```java
public interface ConfigService {
    /** Legacy: system-property / env-var lookup. */
    String get(String key);

    /**
     * Returns the settings module document for the given module ID.
     * Lazily re-reads from disk if the file's mtime has changed since last read.
     * Module files are expected at: {queryeer.settings.dir}/{moduleId}.json
     */
    SettingsModule getModule(String moduleId);
}

/** A settings module document read from disk. */
record SettingsModule(String moduleId, long version, String updatedAt,
                      Map<String, Object> values) {}
```

### 3.2 FileBasedConfigService (`backend-core`)

Replaces `InMemoryConfigService`:

- `settingsDir` from `config.get("queryeer.settings.dir")` (env/system property)
- Reads `{settingsDir}/index.json` at startup → discovers available module file paths
- Per-module cache: `CachedModule { Path filePath, long lastMtime, SettingsModule cached }`
- `getModule(moduleId)`: stat file mtime → return cached if unchanged, else re-read from `{settingsDir}/{moduleId}.json`
- No background watcher threads. No polling. Pure lazy mtime check per call.
- `get(key)`: delegates to in-memory system-property map (legacy)

### 3.3 What ConfigService does NOT do

- Does NOT know about connections — plugins that need connections (JDBC, ES) handle their own connection resolution using ConfigService as a data source
- Does NOT handle secret decryption — `SecretRefPayloadResolver` remains the single decryption point
- Does NOT know engine-specific schema — each plugin knows which moduleId and settingId contains its connections

---

## 4. Protocol Changes

### 4.1 `queryengine.execute` — Final Shape

```java
// backend-contract/QueryExecuteParams.java
public record QueryExecuteParams(
    String queryExecutionId,
    String engineId,
    String fileId,
    String text,
    Object engineState,              // engine-specific — no credentials
    QueryExecuteOptions options
)
```

**Removals:**
- `List<Object> parameters` — dead code (never set by frontend, dropped by transport, never read by engines)
- `Object engineState` (old credential blob) — replaced by slim `engineState` without credentials
- `String connectionId` (separate field) — absorbed into `engineState`
- `Object engineConfig` (separate field) — absorbed into `engineState`

**`engineState` contracts per engine:**

JDBC:
```json
{ "connectionId": "prod-db" }
```

Payloadbuilder:
```json
{
  "defaultAlias": "es1",
  "catalogs": {
    "es1": {
      "catalogId": "elasticsearch",
      "properties": { "connectionId": "cluster1", "index": "my-idx" }
    }
  }
}
```

### 4.2 `QueryCompletedNotification` — Rename

```java
// backend-contract/query/QueryCompletedNotification.java
public record QueryCompletedNotification(
    String queryExecutionId, long elapsedMs, long rowCount,
    QueryMetrics metrics,
    Object engineState              // was engineStatePatch — renamed for symmetry
)
```

`engineState` flows in (query input) and `engineState` flows out (completion changes). One name, one concept.

### 4.3 `file.bind` — Removed

`file.bind` protocol method is removed entirely. It was only called when the user changed the JDBC connection dropdown. Superseded by auto-upsert in `QueryExecutionService`.

**Removed contracts:**
- `FileBindParams` 
- `FileBindResult`
- `FileBindRequestHandler`

### 4.4 `file.open` — Unchanged

Remains for initial file lifecycle notification. Auto-upsert handles rebinding.

---

## 5. Auto-Upsert on Query

In `QueryExecutionService.execute()`:

```
1. Look up engine provider from engineRegistry
2. Parse engineState for connectionId (engine-specific parsing)
3. If connectionId present:
   a. fileRegistry.get(fileId) → if missing, open session with engineId+connectionId
   b. if session.connectionId != connectionId, call fileRegistry.bind()
4. Resolve connection credentials from plugin's connection registry (populated from ConfigService)
5. secretResolver.materialize(resolvedConfig) → decrypt secretRefs
6. provider.execute(queryExecutionId, fileId, text, resolvedEngineState, publisher)
```

---

## 6. Backend Engine Changes

### 6.1 JDBC Plugin

**Config loading:** `JdbcSettingsConnectionSource` uses `ConfigService.getModule("core.queryengine.jdbc")` instead of direct file read.

**Watcher removal:** `JdbcSettingsWatcher` deleted. ConfigService's lazy mtime check handles reload.

**Query execution:** `JdbcQueryEngineProvider.execute()` receives `engineState` containing `{ connectionId }`. Resolves full connection config from `JdbcConnectionRegistry` (already populated from ConfigService at startup / on reload).

**Engine invoke:** `schemaFetch()` already resolves from `JdbcConnectionRegistry` by connectionId. No change needed in method body — just frontend stops passing `password`/`properties`.

### 6.2 Payloadbuilder/Elasticsearch Plugin

**Config loading:** `ElasticsearchCatalogProvider` (or a new ES connection registry) uses `ConfigService.getModule("core.queryengine.payloadbuilder.elasticsearch")` → `values["core.queryengine.payloadbuilder.elasticsearch.connections"]` → find by connectionId.

**Query execution:** `PayloadbuilderQueryEngineProvider.execute()` receives `engineState` containing catalog config (aliases, catalogIds, per-catalog properties like connectionId, index). For each catalog instance, resolves credentials from ConfigService:
```
engineState.catalogs["es1"].properties.connectionId = "cluster1"
  → configService.getModule("core.queryengine.payloadbuilder.elasticsearch")
  → values["core.queryengine.payloadbuilder.elasticsearch.connections"]
  → find by connectionId → endpoint, authType, authUsername, authPassword
  → merge into catalog properties (but NOT as persisted — runtime-only injection)
  → secretResolver.materialize() → decrypt secretRefs
  → build ESCatalog → configure QuerySession
```

**Engine invoke:** `ElasticsearchCatalogProvider.listIndices()` receives `{ properties: { connectionId } }`. Resolves endpoint/auth from ConfigService by connectionId. No more auth fields in payload.

---

## 7. Frontend Changes

### 7.1 TypeScript Contracts (`src/contracts/backend/Types.ts`)

Remove:
- `parameters` from `QueryExecuteParams`
- `FileBindParams` / `FileBindResult`
- `file.bind` from `BackendRequestMethod`

Rename:
- `engineStatePatch` → `engineState` in `QueryCompletedNotification`

### 7.2 QueryEngineService (`src/plugins/core.queryengine/QueryEngineService.ts`)

`ExecuteParams` type becomes:
```ts
type ExecuteParams = {
  engineId?: string;
  text: string;
  fileId: string;
  engineState?: unknown;   // slim — just connectionId or catalog config
};
```

### 7.3 JDBC Plugin

**Remove** `registerExecutionContextProvider` from `plugin.tsx` — no more engineState injection with credentials.

**Strip** `password` and `properties` from invoke payloads in `jdbc-navigation-store.ts` — pass only `{ connectionId, scope, target }`.

### 7.4 Payloadbuilder Plugin

**Update** `registerExecutionContextProvider` in `plugin.tsx` — send catalog config as `engineState` WITHOUT credentials:
```ts
engineState: {
  defaultAlias: document.defaultCatalogAlias,
  catalogs: sanitizedCatalogInstances  // no resolveRuntimeProperties
}
```

**Remove** `buildEngineState()` from `catalog-store.ts` and `resolveRuntimeProperties()` call.

**Remove** `resolveRuntimeProperties` from `elasticsearch-catalog-contribution.tsx`.

**Strip** auth fields from ES invoke payloads — pass only `{ properties: { connectionId } }`.

### 7.5 File Binding Cleanup

- Remove `bindEngine()` / `bindFile()` / `bindBackendFile` from `FileMediator` and `backendSync` (since `file.bind` protocol method is removed)
- `JdbcConnectionSelector.handleConnectionChange()` no longer calls `fileMediator.bindEngine()` — connection change is communicated on next query

---

## 8. File-by-File Change List

### New Files

| File | Purpose |
|------|---------|
| `backend-api/.../SettingsModule.java` | Settings module record |
| `backend-core/.../FileBasedConfigService.java` | Settings file reader with lazy mtime reload |

### Modified Files — Backend

| File | Change |
|------|--------|
| `backend-api/.../ConfigService.java` | Add `getModule(String)` method |
| `backend-core/.../BackendPlatformServices.java` | Replace `InMemoryConfigService` with `FileBasedConfigService` |
| `backend-core/.../InMemoryConfigService.java` | Delete or keep for tests |
| `backend-core/.../query/QueryExecutionService.java` | Auto-upsert logic; pass engineState through |
| `backend-core/.../engine/EngineInvokeService.java` | Connection resolution before invoke |
| `backend-core/.../DefaultFileRegistry.java` | Remove `bind()`? or keep internal for auto-upsert |
| `backend-contract/.../query/QueryExecuteParams.java` | Remove `parameters`; keep `engineState` as single blob |
| `backend-contract/.../query/QueryCompletedNotification.java` | Rename `engineStatePatch` → `engineState` |
| `backend-contract/.../file/FileBindParams.java` | **Delete** |
| `backend-contract/.../file/FileBindResult.java` | **Delete** |
| `backend-contract/.../connection/ConnectionUpsertParams.java` | Review — may need changes |
| `backend-transport-stdio/.../QueryExecuteRequestHandler.java` | Reflect new params |
| `backend-transport-stdio/.../FileBindRequestHandler.java` | **Delete** |
| `backend-transport-stdio/.../RequestDispatcher.java` | Remove `file.bind` route |
| `backend-plugin-jdbc/.../JdbcSettingsConnectionSource.java` | Use `ConfigService.getModule()` |
| `backend-plugin-jdbc/.../JdbcSettingsWatcher.java` | **Delete** |
| `backend-plugin-jdbc/.../JdbcBackendPlugin.java` | Wire ConfigService; remove watcher |
| `backend-plugin-jdbc/.../JdbcQueryEngineProvider.java` | Simplify execute(); remove engineState parsing for credentials |
| `backend-plugin-payloadbuilder/.../PayloadbuilderBackendPlugin.java` | Inject ConfigService |
| `backend-plugin-payloadbuilder/.../PayloadbuilderQueryEngineProvider.java` | Accept new engineState shape; resolve credentials before catalog build |
| `backend-plugin-payloadbuilder/.../PayloadbuilderEngineStateSupport.java` | Update parse() for new engineState shape |
| `backend-plugin-payloadbuilder/.../elasticsearch/ElasticsearchCatalogProvider.java` | Resolve connection from ConfigService |

### Modified Files — Frontend

| File | Change |
|------|--------|
| `src/contracts/backend/Types.ts` | Remove `parameters`, `FileBindParams`, `engineStatePatch` rename |
| `src/contracts/backend/Methods.ts` | Remove `file.bind` |
| `src/contracts/backend/Envelope.ts` | Reflect changes |
| `src/plugins/core.queryengine/QueryEngineService.ts` | Update `ExecuteParams` type |
| `src/plugins/core.queryengine.jdbc/plugin.tsx` | Remove `registerExecutionContextProvider` |
| `src/plugins/core.queryengine.jdbc/jdbc-navigation-store.ts` | Strip credentials from invoke payloads |
| `src/plugins/core.queryengine.jdbc/JdbcConnectionsSettingsEditor.tsx` | Strip credentials from test connection invoke |
| `src/plugins/core.queryengine.payloadbuilder/plugin.tsx` | Update `registerExecutionContextProvider` |
| `src/plugins/core.queryengine.payloadbuilder/catalog-store.ts` | Remove `buildEngineState()`, `resolveRuntimeProperties()` |
| `src/plugins/core.queryengine.payloadbuilder.elasticsearch/elasticsearch-catalog-contribution.tsx` | Remove `resolveRuntimeProperties`; strip auth from invoke |
| `src/plugins/core.files/FileMediator.ts` | Remove `bindEngine()` / `bindFile` calls |
| `src/main/backend/backend-gateway.ts` | Remove `bindFile` IPC handler |
| `src/preload/index.ts` | Remove `bindBackendFile` channel |
| `src/renderer/bootstrap.ts` | Remove `bindFile` from backendSync |

### Modified Files — Documentation

| File | Change |
|------|--------|
| `documentation/BACKEND_PROTOCOL.md` | Document new params shapes; remove `file.bind` |

### Test Files to Update/Add

| File | Change |
|------|--------|
| `backend-core/.../FileBasedConfigServiceTest.java` | **New** — unit tests |
| `backend-core/.../QueryExecutionServiceTest.java` | Update for new params |
| `backend-plugin-jdbc/.../JdbcBackendPluginTest.java` | Update for ConfigService integration |
| `backend-core/.../SecretRefPayloadResolverTest.java` | Verify unchanged behavior |
| `queryeer-desktop/.../backend-gateway.test.ts` | Remove file.bind tests |
| `queryeer-desktop/.../backend-integration.test.ts` | Update for new protocol |

---

## 9. Implementation Order

1. ConfigService interface & FileBasedConfigService (`backend-api` + `backend-core`)
2. Java contracts (`backend-contract`)
3. Backend plumbing (`QueryExecutionService`, handlers, transport)
4. JDBC plugin refactor
5. Payloadbuilder/ES plugin refactor
6. TypeScript contracts
7. Frontend cleanup
8. Protocol documentation
9. Tests

---

## 10. Non-Goals

- Secrets in `connection.upsert` payloads — handled in separate streamlining
- `engineStatePatch` in notifications other than `completed` — unchanged
- Workspace persistence format — unchanged
- Frontend settings storage mechanism — unchanged
