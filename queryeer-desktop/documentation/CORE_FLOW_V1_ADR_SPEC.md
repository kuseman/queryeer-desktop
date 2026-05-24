# Core Flow (.qflow) v1 ADR + Spec

Status: paused after contribution-first flow foundation

Scope: `queryeer-desktop` flow authoring/execution UX and client-side orchestration over existing query-engine execution.

Last updated: 2026-05-26

## Goal

Introduce a first-class flow document type (`.qflow`) in Queryeer where users can author multi-node flows, execute nodes with predictable stop-on-failure semantics, inspect shared context (`ctx`), and evolve from mock execution to real query-engine execution without rewriting the editor model.

## Non-goals (current phase)

- No dedicated backend flow runtime.
- No new backend protocol/capability for flow orchestration.
- No backend-owned flow document execution API.
- No advanced visual node graph UI yet (text-first authoring remains primary).

## ADR decisions

### ADR-001: File identity and editor binding

Decision:

- Flow files use:
  - MIME: `application/vnd.queryeer.flow+plain`
  - Extension: `qflow`
  - Editor ID: `core.flow.editor`
  - Monaco language ID: `qflow`

Rationale:

- Keeps flow files independently discoverable/routable in Queryeer file/editor registries.
- Allows dedicated language/completion behavior without affecting SQL/plaintext editors.

Consequences:

- `.qflow` files are recognized by core MIME registration and open in the flow editor by default.

### ADR-002: Text format and metadata contract

Decision:

- Each node is defined as:
  - metadata block start: `%%queryeer-flow`
  - metadata body as a YAML object
  - metadata block end: `%%`
  - action body follows until next metadata block.
- Known metadata keys:
  - `id`, `type`, `description`, `runIf`
- Unknown top-level keys are preserved in `metadata.additional`.

Rationale:

- Human-readable and git-diff-friendly format.
- Simple parser with deterministic ranges for line-based operations.

Consequences:

- Parser emits diagnostics for malformed blocks/metadata.
- Serializer supports stable round-tripping.

### ADR-003: Execution semantics (v1)

Decision:

- Supported run modes:
  - `Run all`
  - `Run to node` (used by cursor targeting)
  - `Run node only`
- Execution stops on first failure for `Run all` and `Run to node`.
- Downstream selected nodes after first failure are marked `skipped` with `blockedByFailure`.
- `runIf` false results in `skipped` with `runIfFalse`.

Rationale:

- Deterministic and easy-to-explain behavior.
- Aligns with orchestration expectations and prevents accidental downstream writes.

Consequences:

- UI/status model must preserve failure boundary and skip reasons.

### ADR-004: Runtime boundary and mock fallback

Decision:

- Flow orchestration remains renderer/client-side (no backend flow contract).
- Registered node-type contributions own real node execution when available.
- The renderer-local mock executor remains available as fallback/test scaffolding for non-query nodes.
- `flow.fail` token is used to simulate node failure in tests and fallback UI.

Rationale:

- Enables fast UX/runtime iteration without introducing backend flow orchestration.
- Keeps test coverage available for core stop-on-failure behavior independent of query engines.

Consequences:

- Query-backed node output is contribution-provided and adapted into the flow execution envelope.
- Fallback mock output is still intentionally simple.

### ADR-005: Contribution-first execution boundary

Decision:

- `core.flow` remains the renderer/client orchestration engine and UI shell only.
- Node behavior is provided by registered node-type contributions.
- `core.flow` owns parsing, execution ordering, `runIf`, context propagation, editor orchestration, execution state, and generic sidecar slots.
- `core.flow` does not own query-engine-specific metadata, mapping semantics, engine-state resolution, repair UI, summaries, or provider-specific fields.
- Query-backed node types execute through query-engine-owned contributions that may call `QueryEngineService` using normal `queryengine.execute` backend requests.
- No new backend methods, capabilities, Java contracts, or backend flow runtime are introduced for v1.
- The backend remains unaware of `.qflow` orchestration and receives ordinary per-node execution requests from the owning contribution.
- Flow results remain in the flow editor/sidebar execution model by default; they are not written to normal query output panels to avoid result clutter.

Rationale:

- Matches Queryeer's contribution model: core modules orchestrate, feature modules contribute behavior.
- Prevents `core.flow` from becoming a registry of query-engine exceptions.
- Reuses already-defined query execution boundaries and engine integrations when a node contribution is query-backed.
- Keeps v1 incremental and avoids premature backend orchestration contracts.
- Preserves current stop-on-failure and context semantics in one client-side orchestrator.

Consequences:

- Flow execution delegates each node to the contribution for `node.metadata.type`.
- Contributions adapt their own runtime output/errors into the canonical flow execution envelope.
- Debug output-panel integration can be added later as an explicit opt-in per node/session, not as default behavior.
- Existing `type: query` / `queryEngine` draft work is superseded; backwards compatibility is not required before v1.

### ADR-006: Authoring assistance routing

Decision:

- Completion behavior is cursor-region aware:
  - `runIf` value region: context/function suggestions
  - metadata key/value regions: metadata-focused suggestions
  - action region: node-type-specific suggestions (query/script)

Rationale:

- Keeps completion relevant to current authoring intent.

Consequences:

- Completion logic depends on parser range fidelity and line-aware context resolution.

### ADR-007: Flow file is source of truth

Decision:

- Node configuration UI writes edits into the `.qflow` document; it does not create hidden durable node configuration.
- Local-only bindings/secrets may live in user/workspace settings owned by the contributing module.
- `core.flow` may expose generic active flow environment state, but contribution-owned settings resolve contribution-owned metadata into runtime state.

Rationale:

- Keeps flow files reviewable, portable, and git-friendly.
- Allows rich UI without inventing a second persisted flow model.
- Lets query engines reuse their native settings and selectors without leaking local UUIDs/secrets into shared flow files.

Consequences:

- Sidecar editors and node creation wizards need text-edit helpers for metadata updates.
- Contributions must distinguish portable flow metadata from local binding state.

### ADR-008: Text-first UX with collapsed metadata, CodeLens, and sidecar configuration

Decision:

- Metadata blocks are collapsed by default.
- A gutter `[...]` affordance toggles visibility of each node metadata block.
- Monaco CodeLens above each node shows core actions/status plus contribution-provided summaries/actions.
- Entering a node updates a sidecar panel in the sidebar contribution.
- The sidecar shows core fields (`id`, `type`, `description`, `runIf`) and a contribution-rendered configuration section.

Rationale:

- Keeps `.qflow` files text-native while reducing metadata noise during day-to-day execution.
- Mirrors proven Monaco patterns such as test CodeLens: `Run Tests | Debug Tests | Find References`.
- Gives complex node types a discoverable UI without forcing users to hand-edit YAML.

Consequences:

- `core.editor` needs CodeLens and metadata hiding/folding support exposed through its editor abstraction.
- Mapping/configuration repair is handled by CodeLens plus sidecar configuration, not inline mapping forms.

## Implemented so far

### Contracts and registration

- Added flow constants and IDs.
- Registered flow MIME + extension + Monaco language mapping in text editor MIME setup.
- Added files plugin extension override for flow MIME -> `qflow`.

### Plugin and UI shell

- Added `core.flow` plugin module and activation wiring.
- Registered flow editor contribution and primary sidebar context view.
- Added `core.flow.new` command, toolbar action, and File menu entry.
- Added Monaco language bootstrap and tokenization for `qflow`.

### Parser, execution, and state

- Added `.qflow` parser/serializer with diagnostics and line-to-node resolution.
- Added flow execution/status model with contribution dispatch and mock fallback.
- Statuses:
  - `pending`, `running`, `completed`, `failed`, `skipped`
- Added skip reasons:
  - `runIfFalse`, `blockedByFailure`
- Added per-file flow state store + React snapshot hook.

### Editor behavior

- Added flow editor shell with:
  - `Run Flow`
  - `Run to Cursor`
  - `Run Node`
  - status summary
  - node status panel
- Added sidebar context (`ctx`) rendering.

### Completion routing (latest)

- Added qflow completion resolver and context model.
- Added `runIf` suggestions (`ctx`, `ctx.<nodeId>`, `ctx.<nodeId>.output.rowsAffected`, expression functions).
- Added metadata suggestions for known keys and selected value fields.
- Added action suggestions by node type (query/script).
- Wired completion provider into `qflow` Monaco language.

### Contribution-first query execution and local mappings

- Added node-type contribution registry for contribution-owned flow behavior.
- Registered query-backed node types:
  - `jdbc.query`
  - `payloadbuilder.query`
- Query-backed nodes execute through existing query-engine execution paths; no backend flow runtime/protocol was added.
- Explicit flow `engineState` remains isolated from normal editor context providers.
- Mock execution remains available as fallback for non-query nodes/tests.
- Added workspace-scoped `core.flow.environments` with:
  - active environment selector in the flow editor header
  - explicit environment names so empty environments persist
  - mappings keyed by `(environment, owner, kind, ref)`
- Added symbolic ref resolution for portable flow metadata. JDBC example:

```yaml
jdbc:
  connection: sales-server
  database: orders
```

- Added editor-native mapping repair for missing and invalid/stale mappings.
- Added query-engine mapping option contribution registry.
- JDBC contributes:
  - a single connection selector that writes a portable shared ref or local mapping as needed
  - database dropdown loaded from `JdbcDatabaseCache` (same cache path as the JDBC database quick command)
  - local-only connection UUIDs resolved through `core.flow.environments.mappings` entries owned by `core.queryengine.jdbc`
  - CodeLens and sidecar status for missing/invalid mappings
  - flow code isolated in `core.queryengine.jdbc/flow-node-contribution.tsx`
- Payloadbuilder contributes:
  - environment dropdown from existing Payloadbuilder environment settings
  - catalog provider dropdown from registered Payloadbuilder catalog contributions
  - provider-specific mapping fields such as Elasticsearch `connectionId`/`index` and JDBC `connectionId`/`database`
  - catalog engine-state fragments under `payloadbuilder.catalogs`, keyed by SQL catalog alias
  - a single-catalog sidecar editor for now, while the `.qflow` file shape already supports multiple aliases
  - local-only ids in flow mapping fields (for example connection UUIDs) are persisted as portable labels and resolved to local ids at runtime
  - unmapped portable refs are resolved through local `core.flow.environments.mappings` entries keyed by environment, owner, kind, and ref
  - CodeLens and sidecar configuration surface missing/invalid mappings without requiring edits to the shared `.qflow` file
  - flow code isolated in `core.queryengine.payloadbuilder/flow-node-contribution.tsx`
- Payloadbuilder execution resolves environment refs with this precedence:
  - explicit `payloadbuilder.environment` maps that symbolic name/title to a local Payloadbuilder environment
  - when omitted, no Payloadbuilder environment override is sent
- Mapping visibility is CodeLens-first, with sidecar repair for missing/invalid mappings.
- Summaries prefer local titles over UUIDs/ids where contribution options expose labels.

### Tests

- Added/updated focused tests for:
  - MIME registration
  - plugin registration/command behavior
  - parser behavior and diagnostics
  - executor semantics (including stop-on-failure)
  - flow state behavior
  - completion routing
  - query-service flow runner behavior
  - flow environment and symbolic mapping resolution
  - mapping repair persistence and CodeLens/sidecar behavior
  - JDBC flow local mapping contributions
  - Payloadbuilder single- and multi-catalog flow mapping contributions

## Validation status

Desktop validation commands have been run successfully in this session:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `npm run test:integration`

Additional focused plugin tests also pass for `core.flow` and related MIME mappings.

Known non-blocking build warnings remain from third-party `@glideapps/glide-data-grid` PURE annotations.

## Pause point

Development can pause here with a coherent contribution-first foundation:

- `core.flow` owns text parsing, execution orchestration, metadata collapse, CodeLens shell, sidecar shell, `runIf`, context propagation, and generic flow environment/mapping storage.
- `core.queryengine.jdbc` owns `jdbc.query` metadata, local connection binding semantics, validation, CodeLens mapping status, sidecar fields, and runtime engine-state conversion.
- `core.queryengine.payloadbuilder` owns `payloadbuilder.query` metadata, local catalog/connection binding semantics, validation, CodeLens mapping status, sidecar fields, and runtime engine-state conversion.
- `.qflow` remains the source of truth for portable node metadata.
- Local machine bindings remain outside `.qflow` under `core.flow.environments.mappings`.
- No backend flow protocol/runtime exists or is required for the current implementation.

Known non-blocking state at pause:

- Build warnings from third-party `@glideapps/glide-data-grid` PURE annotations remain unrelated.
- Manual UX validation is still recommended before declaring v1-ready.
- Some older tests/utilities around removed inline result presentation may remain as cleanup candidates.

## Current metadata shapes

JDBC single-query node:

```yaml
id: load_orders
type: jdbc.query
description: Load orders
jdbc:
  connection: sales-server
  database: orders
```

Payloadbuilder single-catalog node:

```yaml
id: search_orders
type: payloadbuilder.query
payloadbuilder:
  environment: prod
  defaultCatalogAlias: search
  catalogs:
    search:
      provider: elasticsearch
      connectionId: search-prod
      index: orders-*
```

Payloadbuilder multi-catalog file shape, supported by execution and mapping resolution but not yet by multi-catalog sidecar editing:

```yaml
id: join_search_reporting
type: payloadbuilder.query
payloadbuilder:
  environment: prod
  defaultCatalogAlias: es
  catalogs:
    es:
      provider: elasticsearch
      connectionId: search-prod
      index: orders-*
    jdbc:
      provider: jdbc
      connectionId: reporting-db
```

Local mapping storage example:

```json
{
  "activeEnvironment": "dev",
  "environments": ["dev"],
  "mappings": [
    {
      "environment": "dev",
      "owner": "core.queryengine.jdbc",
      "kind": "jdbc.connection",
      "ref": "sales-server",
      "value": "local-jdbc-uuid"
    },
    {
      "environment": "dev",
      "owner": "core.queryengine.payloadbuilder",
      "kind": "elasticsearch.connection",
      "ref": "search-prod",
      "value": "local-elasticsearch-uuid"
    }
  ]
}
```

## Resume checklist

When resuming flow work, start with this order:

1. Re-run validation:
   - `npm run typecheck`
   - `npm run lint`
   - `npm run build`
   - `npm run test:integration`
   - focused flow/JDBC/Payloadbuilder suites touched by the resume work
2. Manual UX pass for local bindings:
   - open a received `.qflow` with an unmapped JDBC `jdbc.connection`
   - confirm missing mapping CodeLens appears
   - configure it in the sidecar with `Use local`
   - confirm `.qflow` keeps the portable ref and local settings store the UUID mapping
   - repeat for Payloadbuilder Elasticsearch/JDBC catalog refs
3. Manual vault pass:
   - lock the vault
   - run a flow query node that needs a secret-backed connection
   - confirm unlock dialog appears and execution retries once
4. Decide whether to keep or remove dead inline result presenter/test artifacts.
5. Add higher-level editor integration tests for parser + editor + command path, run-to-cursor targeting, stop-on-failure propagation, and context lifecycle between runs.
6. Decide if Payloadbuilder needs multi-catalog sidecar editing for v1 or if execution-only support is enough.
7. Decide if generic flow environments should stay in `core.flow` long-term or move fully into contributor-owned binding settings.

## Deferred or rejected for now

- Inline mapping/configuration controls in the editor are not part of the current UX; use CodeLens plus sidecar.
- Inline result zones were removed; if result previews return later, they should be an explicit debug/preview feature rather than the default execution output path.
- A visual node graph remains out of scope for the current text-first v1 foundation.

## Contract rule

Mandatory cross-repo contract rule if future work changes backend-facing protocol shapes:

- Update TypeScript contracts in `queryeer-desktop/src/contracts/backend/*`.
- Update Java contracts in `queryeer-backend/backend-contract/*`.
- Update protocol documentation in `queryeer-desktop/documentation/BACKEND_PROTOCOL.md`.
- Current flow work should not require these updates because it reuses existing `queryengine.execute` contracts.

## Open decisions

- Whether Payloadbuilder multi-catalog sidecar editing is required for v1.
- Whether generic flow environments remain in `core.flow` or move fully into contribution-owned binding settings.
- How much strictness should parser enforce up-front vs allowing lenient authoring with warnings?
- Whether future result previews should use CodeLens/sidecar/output panels instead of inline editor zones.

## Exit criteria for v1

- `.qflow` authoring is stable with collapsed metadata, CodeLens actions/status, and sidecar configuration.
- Execution path uses node type contributions, with query-backed contributions calling real query-engine services where applicable.
- Stop-on-failure behavior is covered by tests across editor + runtime boundaries.
- JDBC and Payloadbuilder local mapping UX is manually validated with received/shared `.qflow` files.
- Protocol/contracts/docs are synchronized where backend contracts are introduced.
