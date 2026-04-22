# Queryeer Electron Migration Plan

This migration is intentionally incremental. The target architecture is plugin-first and backend-agnostic, with a Java backend behind explicit contracts.

Core ownership and plugin boundaries are defined in `queryeer-desktop/documentation/CORE_BOUNDARY.md`.
Fixed-zone layout contribution model draft is defined in `queryeer-desktop/documentation/LAYOUT_EXTENSION_MODEL.md`.

## Current status snapshot

### Completed so far

#### Increment 1 - Shell foundation (done)

- Electron + React + TypeScript shell scaffold under `queryeer-desktop/`
- VS Code workspace settings/recommendations
- Linting + typecheck + build + packaging scripts
- Secure process split (`main` / `preload` / `renderer`)
- Runnable shell UI
- Preload output/runtime mismatch fixed (`index.cjs` path + CJS preload output)

#### Increment 2 - Plugin runtime baseline (done)

- Typed plugin contracts (`Plugin`, `PluginManifest`, extension contracts)
- Plugin lifecycle support (`activate`, optional `deactivate`)
- Core runtime services (`PluginHost`, `PluginRegistry`, `ExtensionRegistry`)
- Built-in core plugins:
  - `core.layout`
  - `core.filesystem`
  - `core.commands`
- Typed command bus added (`register` + `execute`)

#### Increment 3 - Discovery/validation/diagnostics (substantially complete)

- Manifest-driven discovery introduced (JSON manifests)
- Manifest validation introduced (shape + duplicate id checks)
- Plugin startup validation introduced:
  - missing dependency detection
  - dependency cycle detection
  - missing required capability detection
- Activation order is now dependency-ordered (topological sort)
- Runtime diagnostics UI added:
  - discovered plugins
  - activation order
  - provided capabilities
  - per-plugin manifest diagnostics

#### Increment 4 - File entity + workspace + file watcher (substantially complete)

Three model docs introduced and implemented:

- `documentation/FILE_ENTITY_MODEL.md` — `core.files` plugin, FileEntity, FileMediator, mime/editor resolvers, file.* protocol, Java `FileRegistry` + `FileSessionHandler` SPI.
- `documentation/CORE_FILE_WATCHER_MODEL.md` — `core.fileWatcher` plugin, chokidar in Electron main, dedup + ref-count, mute API.
- `documentation/CORE_WORKSPACE_MODEL.md` — `core.workspace` plugin, `workspace.json` persistence, layout folding, autosave + backup, crash recovery.

Cross-cutting boundary doc added: `documentation/PROCESS_BOUNDARIES.md`.

### In progress now

- Plugin packaging/discovery hardening (folder+zip, duplicate-id handling, diagnostics surfacing)
- Backend observability hardening (status/logging/correlation workstream)
- Core-boundary enforcement (query probe behavior moved out of shell core into fully external dual-target plugin package)
- Mime capability registry for backupable/executable/viewable/editable gating (core.files + core.observability implemented; available for future editor resolver, command palette, etc.)

### Not started yet

- Monaco editor plugin (or any text-editor plugin) — first real consumer of FileEntity + viewState
- Modal/notification UI plugin — surfaces external-change prompt + crash-recovery prompt; consumes `WorkspaceService.listPendingRestores`/`readBackup`/`discardBackup`
- Real query engine adapters wired end-to-end to persisted backend state
- Output plugins and result routing
- Credential encryption/persistence and full connection lifecycle
- Engine-specific `FileSessionHandler` implementations (payloadbuilder first) — increment 5 of the file entity model; deferred until editor + output wiring land

### File entity model progress

- Increment 1 — core FE registry + ShellApp migration: done
- Increment 2 — resolvers + mime classification: done
- Increment 3 — FileMediator: done
- Increment 4 — protocol + Java `DefaultFileRegistry` + `FileSessionHandler` SPI: done
- Increment 5 — engine binding + execute reuse of parse trees: deferred (premature without editor/output wiring)

Design reference: `documentation/FILE_ENTITY_MODEL.md`.

### File watcher model progress

- Increment 1 — service scaffold + IPC: done
- Increment 2 — chokidar single-path watch: done
- Increment 3 — dedup + refcount per `(uri, recursive)`: done
- Increment 4 — active per-URI mute timers (`mutePath` / `unmutePath` / `dispose`): done
- Increment 5 — event normalization (Windows atomic-save delete+add coalescing, inotify-limit warning): deferred until first real-world Windows feedback from a workspace consumer

Design reference: `documentation/CORE_FILE_WATCHER_MODEL.md`.

### Workspace model progress

- Increment 1a — file state persistence + restore: done
- Increment 1b — layout folding into workspace doc: done
- Increment 2 — FileEntity flags (externallyModified, reloadPending, backupUri, hasRecoveredBackup) + mediator reload/accept/discard: done
- Increment 3 — fileWatcher integration (per-file subs, four-branch flag matrix, auto-reload-on-activate): done
- Increment 4 — autosave + backup (3s debounce + 30s max-interval, separate backups folder, retention=5, dirty/close cleanup): done
- Increment 5 — crash recovery (persist backupFileId, detect surviving backups on hydrate, expose `listPendingRestores`/`readBackup`/`discardBackup` for future modal UX): done
- Increment 6 — backup gating (mime capability registry with `backupable`/`executable`/`viewable`/`editable` capabilities; content validation; `core.files` registers default capabilities; `core.observability` registers `viewable` only): done

Design reference: `documentation/CORE_WORKSPACE_MODEL.md`.

## Current focus (next 2 sprints)

### Sprint A: plugin/discovery production hardening

- Finalize external plugin packaging rules and document expected zip/folder layouts
- Expand negative-path diagnostics coverage (malformed plugin bundles, dynamic import failures)
- Complete duplicate-id/fallback behavior decisions and enforce them consistently across desktop + backend runner
- Finalize packaging policy for developer-only feature plugins (for example `dev.query-probe`) across dev/prod profiles

### Sprint B: backend runtime maturation toward real execution

- Extend Java request-level correlation and redaction beyond startup logs
- Replace mocked query execution path with first real engine-backed execution slice (Payloadbuilder first)
- Start credential persistence hardening (secure storage boundary + non-mock flow contract adherence)

## Architecture principles

1. **Everything is a plugin**
   - Core capabilities (filesystem, layout, tab/panel orchestration) are plugins.
   - Feature capabilities (editor, query engines, output renderers) are plugins.
2. **Stable contracts before features**
   - Define plugin interfaces, lifecycle and IPC contracts early.
   - Avoid tightly coupling renderer UI to backend implementation details.
3. **Strict process boundaries**
   - `main`: application lifecycle, windows, process management.
   - `preload`: secure bridge with typed API surface.
   - `renderer`: UI and plugin host.
4. **Incremental parity**
   - Deliver a thin vertical slice each increment.
   - Keep Swing Queryeer as source-of-truth until each capability is proven.

## Target module model

### Core plugins

- `core.runtime`: lifecycle/validation/diagnostics host orchestration
- `core.layout`: dock/panel/tab layout engine, persisted layout state
- `core.commands`: command registry, keybindings, command palette
- `core.workspace`: workspace/session state and context
- `core.settings`: user/workspace settings and schema registration
- `core.storage`: non-secret persistence abstraction for plugin state
- `core.secrets`: secure secret boundary for credentials/tokens
- `core.backend-gateway`: Java process lifecycle + transport boundary
- `core.notifications`: user notifications/progress/error surfacing
- `core.filesystem` (optional): file IO abstractions/watchers/path operations

### Feature plugins

- `editor.monaco`: Monaco host, language registration, completion API, diagnostics API
- `query.payloadbuilder`: query execution adapter over backend contract
- `query.jdbc`: jdbc query adapter over backend contract
- `output.table`: virtualized tabular output renderer
- `output.text`: text/log output renderer
- `dev.query-probe`: developer-only backend execute/cancel probe panel plugin

Query engines, query UX, connections, and result renderers are treated as external plugins (not core-owned functionality).
`dev.query-probe` is now treated as a fully external dual-target plugin package (`plugins/dev-query-probe`) rather than an internal bundled plugin.

### Backend boundary

- `backend.gateway` in Electron main process manages Java process lifecycle
- Transport: start with stdio JSON-RPC, optionally evolve to gRPC/WebSocket
- Typed contracts for: execute query, cancel, metadata, file operations, diagnostics, AI assistants

## Java backend architecture plan (new)

This section defines the first architecture pass for the Java backend before implementation starts.

### Goals

- Preserve Queryeer domain behavior while decoupling UI concerns from backend execution
- Provide a stable, versioned contract between Electron and Java
- Support cancellation, streaming/progressive responses, and diagnostics from day one
- Keep transport swappable without rewriting application services

### Backend component model

#### Electron side

- `backend.gateway` (main process):
  - owns Java process lifecycle
  - performs request routing and timeout management
  - enforces protocol framing and correlation ids
- `backend.client` (renderer-facing API via preload):
  - exposes typed request/response methods
  - hides transport/protocol details from plugins

#### Java side

- `BackendBootstrap`:
  - starts protocol server over stdio
  - loads module graph and service registry
- `ProtocolAdapter`:
  - JSON-RPC parsing/serialization
  - request validation + error mapping
- `ApplicationServices` (use-case layer):
  - query execution orchestration
  - metadata/schema requests
  - config/credential operations (through explicit services)
- `EngineAdapters` (infrastructure layer):
  - payloadbuilder adapter
  - jdbc adapter
  - future engine adapters

### Clean architecture layering (Java)

- **Domain**: core query concepts (request, result stream, cancellation token, diagnostics)
- **Application**: use-cases (`ExecuteQuery`, `CancelQuery`, `GetMetadata`, `ListConnections`)
- **Infrastructure**: JDBC/Payloadbuilder/file/network integrations
- **Interface adapters**: JSON-RPC transport adapter and DTO mappers

Rule: dependencies point inward only; transport and engine details must not leak into domain use-cases.

### IPC/protocol plan (phase 1)

- Transport: stdio
- Protocol: JSON-RPC 2.0 style envelope with strict schema validation
- Message categories:
  - requests/responses (`executeQuery`, `cancelQuery`, `getMetadata`, `ping`)
  - server notifications (`query.progress`, `query.resultChunk`, `query.completed`, `query.failed`)
- Correlation:
  - `requestId` generated by gateway
  - `queryExecutionId` for long-running operations
- Error model:
  - typed error codes (`VALIDATION`, `ENGINE_NOT_FOUND`, `TIMEOUT`, `CANCELLED`, `INTERNAL`)

### Lifecycle and resilience requirements

- Startup handshake:
  - Electron sends `backend.handshake` with protocol version + capability expectations
  - Java replies with supported protocol version + capabilities
- Health:
  - periodic `ping` + startup timeout guard
  - backend status surfaced in diagnostics panel
- Recovery:
  - automatic restart policy with capped retries
  - in-flight requests fail fast with explicit restart reason

### Security and trust boundary

- Renderer never talks to backend process directly (only through preload + main gateway)
- Strict JSON schema validation both directions
- No arbitrary method passthrough from renderer
- Credential operations isolated in dedicated service boundary and audited events

### Contract/versioning strategy

- Add protocol version to every handshake
- Maintain backward-compatible additive changes within a major protocol version
- Generate shared TypeScript contract types from a single schema source
- Add contract compatibility tests in CI (Electron fixtures vs Java fixtures)

### Implementation sequence (backend-focused)

1. Define protocol schema (`handshake`, `ping`, `executeQuery`, `cancelQuery`, progress/result notifications)
2. Implement Electron `backend.gateway` process manager with handshake and health checks
3. Create Java protocol bootstrap that supports `handshake` + `ping` only
4. Add query execution vertical slice with mock engine adapter
5. Introduce cancellation + streaming chunks
6. Add first real engine adapter (`payloadbuilder`), then JDBC

### Deliverables checklist before coding backend features

- Written protocol spec with examples and error codes
- Sequence diagrams for startup, execute, cancel, failure/restart
- Contract test harness (TS + Java fixtures)
- Minimal observability plan (structured logs + request ids + execution ids)

### Current backend planning artifacts

- Protocol draft created: `queryeer-desktop/documentation/BACKEND_PROTOCOL.md`
- Includes:
  - envelope format and framing
  - handshake/ping/execute/cancel contracts
  - streaming notifications (`progress`, `resultChunk`, `completed`, `failed`)
  - error code model and timeout guidance
  - sequence flows and implementation checklist
- Initial TypeScript contract scaffold added: `queryeer-desktop/src/contracts/backend/*`
  - typed envelopes (request/response/notification)
  - backend methods and notification method unions
  - params/result maps for handshake/ping/execute/cancel
  - error code model and typed envelope factories
- Backend gateway mock scaffold added:
  - `queryeer-desktop/src/main/backend/backend-gateway.ts`
  - `queryeer-desktop/src/main/backend/mock-java-backend.ts`
  - preload bridge exposes `getBackendStatus()`
  - renderer diagnostics panel now shows backend mode/state/handshake/ping/capabilities
  - gateway supports first end-to-end mock query flow (`query.execute` / `query.cancel`)
  - renderer can trigger mock query execution and view execution state transitions
  - gateway now supports pluggable transport modes (`mock-stdio` and `stdio-process`)
  - backend diagnostics now include a structured in-memory log buffer surfaced to renderer for startup troubleshooting
  - desktop backend gateway internals decomposed into focused stores/buffers (status, executions, pending requests, logs) to keep main-process code maintainable as protocol surface grows
  - resolved a concrete Java/TS wire mismatch by aligning Java `EnvelopeType` JSON values with protocol envelope casing (`request`/`response`/`notification`)
  - introduced first shared protocol fixtures + dual-side checks (desktop + backend-contract) for handshake/ping compatibility
  - backend reactor now centrally manages Jackson/JUnit/Surefire versions via root POM dependency/plugin management
  - desktop now has a real unit-test harness (Vitest) with initial backend main-process unit tests and dedicated test scripts
  - backend gateway now supports injected transport factory in tests, with first orchestration unit tests for startup and execute flow
  - shared protocol fixture suite now covers handshake/ping/execute/cancel and query notifications on both desktop and backend-contract checks
  - gateway negative-path tests added (timeouts/send failures/ping failure/unknown response id) and migration CI workflow now runs desktop+backend drift guardrails on PR/push
  - desktop diagnostics now redact sensitive fields in backend/gateway transport logs before surfacing in UI status panel
  - credential-handle contract scaffold added (`connection.upsert`, `credential.store`) with TS/Java contract updates, protocol fixtures, and mock stdio dispatch support
  - capability/dispatch responsibilities were decomposed: desktop capability constants centralized and Java stdio dispatcher refactored into per-method handlers with registry-based dispatch
  - Java backend platform skeleton v1 now wired: default plugin context services in backend-core, runtime activate/deactivate orchestration, runner composition integration, and architecture tests for lifecycle/wiring
  - backend-core plugin governance now includes dependency + capability validation, cycle detection, and runtime status model (`loaded`/`skipped`/`activated`/`failed`/`deactivated`) with tests
  - runtime diagnostics now include startup summary logs in runner and `backend.runtimeStatus` endpoint surfaced to desktop diagnostics UI
  - backend-runner now supports manifest-first plugin discovery from plugin folder/zip sources with isolated classloaders and built-in fallback when no discovery path is configured
- plugin manifest schema v1 drafted with optional backend/frontend targets and runner target-resolver interfaces introduced for staged dual-target plugin loading
- desktop now wires external frontend plugin target discovery + dynamic module loading from manifest `frontend.entryModule` for folder and zip plugin packages
- desktop plugin discovery now hardens duplicate plugin id behavior by preserving internal manifests and surfacing duplicate external ids as diagnostics load errors
- backend discovery now fails fast on duplicate manifest ids across sources, preventing ambiguous backend/frontend resolver wiring
- backend observability now includes correlated runner startup log prefixes (`runId`, optional `pluginId`) and unknown-method response details carry request context (`requestId`, `method`)
- desktop zip plugin packaging flow is now cross-platform in-process (`jszip`) for both runtime extraction and tests (no PowerShell/unzip dependency)
- desktop validation suite currently passes in-session (`typecheck`, `lint`, `test`, `build`)
- external `dev.query-probe` package now has a streamlined development workflow (`dev:plugin:stage`, `dev:plugin:watch`, `dev:with-plugins`) for fast dual-target iteration
- Java backend architecture draft created: `queryeer-desktop/documentation/JAVA_BACKEND_ARCHITECTURE.md`
  - standalone Maven reactor/module layout
  - backend plugin SPI (`BackendPlugin`, `BackendPluginContext`)
  - injected service boundaries and plugin descriptor model
  - clean layering and transport isolation rules
  - testing strategy and incremental backend build sequence
- Java backend scaffold created: `queryeer-backend/`
  - standalone Maven reactor with modules:
    - `backend-api`
    - `backend-contract`
    - `backend-core`
    - `backend-transport-stdio`
    - `backend-runner`
    - `backend-plugin-payloadbuilder`
    - `backend-plugin-jdbc`
  - initial SPI/contract/runtime skeleton compiles successfully via
    `./mvnw -f queryeer-backend/pom.xml -DskipTests=true clean verify`
  - stdio transport now handles first protocol methods (`backend.handshake`, `health.ping`,
    `query.execute`, `query.cancel`) with mocked notifications

## Increment roadmap

### Increment 1 - Shell foundation (done)

- Create Electron shell project structure
- Dev environment (VS Code, lint, TypeScript checks)
- Build/package scripts
- Empty runnable shell

### Increment 2 - Plugin host baseline (done)

- Define plugin manifest/runtime contracts and registry
- Implement plugin lifecycle (`activate`, `deactivate`, capability registration)
- Boot with internal core plugins only

### Increment 3 - Runtime hardening (completed baseline)

- Introduce command bus (register + execute)
- Add manifest-driven discovery + validation
- Add dependency ordering and capability checks
- Add diagnostics panel with runtime state
- Remaining for this increment:
  - interactive command launcher UI (instead of bootstrap-only probe)

### Increment 4 - Backend contract + transport foundation (largely complete)

- Java backend architecture foundation and standalone reactor scaffold
- Protocol schema + handshake contract with TS/Java fixtures
- Electron `backend.gateway` with process manager transport abstraction
- Java bootstrap service with `handshake` + `ping`
- Backend connectivity and diagnostics surfaced in shell UI

### Increment 5 - First executable backend vertical slice (in progress)

- `executeQuery` + `cancelQuery` contracts and mocked execution path are wired end-to-end
- Runtime status, connection upsert, and credential store contract scaffolds are in place
- Remaining: replace mocked execution and mocked credential handling with real engine/persistence implementations

### Increment 6 - Streaming + engine integration (partially started)

- Streaming notifications (`progress`/`resultChunk`/`completed`/`failed`) are in protocol + fixtures
- Remaining: activate first real engine adapter (`query.payloadbuilder`) behind backend runtime
- Remaining: wire one query plugin through non-mocked backend execution end-to-end

### Increment 7

- Add output plugin host and first output plugins (`output.table`, `output.text`)
- Route query results through output extension points

### Increment 8+

- Feature parity milestones vs Swing Queryeer (engines, outputs, settings, assistant)
- Migration hardening (performance, crash recovery, plugin isolation, telemetry)

## Repository layout (current)

- `queryeer-desktop/src/core/*` platform internals and runtime
- `queryeer-desktop/src/contracts/*` shared API/contract types
- `queryeer-desktop/src/plugins/*` built-in plugins and manifests
- `queryeer-desktop/src/renderer/*` shell UI + bootstrap
- `queryeer-desktop/src/main/*` electron main process
- `queryeer-desktop/src/preload/*` secure preload bridge
- `plugins/*` external plugin packages (for example `plugins/dev-query-probe`)

## Risks and mitigations

- **Plugin complexity early**: keep runtime local/synchronous first, isolate further in later increments.
- **Contract churn**: version contracts and generate TypeScript types from shared schema.
- **UI performance**: adopt virtualization for tabs/results from first output plugin.
- **Backend startup instability**: define retries and health checks before adding feature complexity.
- **Protocol drift between TS and Java**: enforce schema-generated types and compatibility tests in CI.
