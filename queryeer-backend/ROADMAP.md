# Queryeer Backend Roadmap

## Progress tracker

## backend-api

- [x] Initial plugin SPI scaffold (`BackendPlugin`, `BackendPluginContext`, descriptors)
- [x] Add `FileSession` + `FileSessionHandler` + `FileSessionHandlerRegistry` + `FileRegistry` SPI for the file entity model
- [x] Expose `BackendPluginContext.fileSessions()` for engine plugins to register `FileSessionHandler`
- [ ] Finalize service interfaces and naming
- [ ] Add JavaDoc contract guarantees for plugin authors

## backend-contract

- [x] Initial envelope/error/protocol version skeleton
- [x] Add typed DTOs for `backend.handshake`
- [x] Add typed DTOs for `health.ping`
- [x] Add typed DTOs for `query.execute` / `query.cancel`
- [x] Add notification DTOs (`progress`, `resultChunk`, `completed`, `failed`)
- [x] Align JSON envelope type wire values with desktop protocol casing
- [x] Add fixture compatibility tests for handshake/ping shared with desktop fixtures
- [x] Add DTOs for `connection.upsert` / `credential.store` credential-handle flow
- [x] Add DTOs for `backend.runtimeStatus` runtime diagnostics flow
- [x] Add DTOs for `file.open` / `file.close` / `file.bind` request flow
- [x] Add DTO for `file.change` notification
- [x] Add fixture compatibility tests for `file.*` shapes
- [x] Add optional `fileId` to `QueryExecuteParams` for parse-tree reuse

## backend-core

- [x] Initial runtime + unique-id validation scaffold
- [x] Add dependency validation
- [x] Add capability validation
- [x] Add activation/deactivation lifecycle orchestration
- [x] Add plugin status model (`loaded`, `failed`, `skipped`)
- [x] Add default platform service implementations and composed plugin context
- [x] Add architecture tests for runtime lifecycle/wiring behavior
- [x] Add `DefaultFileRegistry` implementing `FileRegistry` + `FileSessionHandlerRegistry`; routes lifecycle events to engine handlers by engineId

## backend-transport-stdio

- [x] Initial transport server stub
- [x] Implement NDJSON envelope reader/writer
- [x] Implement method dispatch for `handshake` + `ping`
- [x] Add `query.execute` / `query.cancel` dispatch with mock notifications
- [x] Add protocol error mapping
- [x] Refactor transport into decomposed components + manual DI wiring
- [x] Add mock dispatch handlers for `connection.upsert` / `credential.store`
- [x] Refactor request dispatch into handler registry + per-method handlers
- [x] Add `backend.runtimeStatus` dispatch handler exposing runtime snapshot
- [x] Add unit tests for request dispatcher routing + unknown-method error mapping
- [x] Add `file.open` / `file.close` / `file.bind` request handlers
- [x] Add `NotificationHandler` + `NotificationDispatcher` and route `file.change` notifications
- [x] Switch `backend-transport-stdio` dependency from `backend-core` to `backend-api` (preserves architectural boundary)

## backend-runner

- [x] Initial boot app scaffold
- [x] Wire concrete plugin context services
- [~] Add startup diagnostics logging with request correlation support (runner-level run/plugin correlation added; request-level correlation still pending)
- [ ] Add graceful shutdown lifecycle handling
- [x] Add manifest-first plugin discovery for folder/zip sources with isolated classloaders
- [x] Add plugin discovery tests for manifest loading and missing manifest errors
- [x] Introduce target-specific plugin resolver contracts (backend/frontend)
- [x] Validate plugin manifest v1 structure for optional backend/frontend targets
- [x] Reject duplicate plugin ids during manifest discovery across folder/zip sources

## backend-plugin-payloadbuilder

- [x] Initial plugin scaffold and engine registration placeholder
- [ ] Implement real engine adapter integration
- [ ] Implement `FileSessionHandler` (engineId = `payloadbuilder`) caching parse trees per `fileId`
- [ ] Wire `query.execute.fileId` to reuse cached parse tree

## backend-plugin-jdbc

- [x] Initial plugin scaffold and engine registration placeholder
- [ ] Implement real JDBC adapter integration
- [ ] Implement `FileSessionHandler` (engineId = `jdbc`) for cached prepared statements (or skip if not applicable)

## Cross-cutting

- [x] Add Spotless formatting enforcement in Maven lifecycle
- [x] Add Checkstyle enforcement in Maven lifecycle
- [x] Prove first end-to-end desktop mock flow for `query.execute` / `query.cancel`
- [x] Surface desktop backend startup diagnostics in renderer (backend log panel)
- [x] Refactor desktop backend gateway state handling into dedicated helper modules
- [x] Add contract fixture tests shared with desktop protocol expectations (handshake/ping/execute/cancel/notifications)
- [x] Centralize backend test/dependency version management in root reactor POM
- [x] Add desktop Vitest unit-test harness with initial backend helper tests
- [x] Add first desktop gateway orchestration unit tests (startup + execute flow)
- [x] Add desktop gateway negative-path tests (timeouts/send failures/ping failure/unknown response id)
- [x] Add CI workflow executing desktop tests + protocol fixtures + backend contract fixture tests
- [~] Implement protocol/diagnostics secret redaction (desktop side done; backend side pending)
- [~] Implement credential-handle flow (`connection.upsert` / `credential.store`) (contract + mock dispatch done; encryption persistence pending)
- [x] Centralize desktop backend capability declarations for handshake requests
- [x] Establish Java backend platform skeleton v1 (service composition + runtime lifecycle baseline)
- [x] Add backend-core governance tests (dependencies/capabilities/cycles/status transitions)
- [x] Surface backend runtime plugin status in desktop diagnostics via protocol endpoint
- [x] Add initial shared plugin manifest schema v1 (`plugin.json`) for dual-target plugin packaging
- [x] Wire desktop-side external frontend target discovery and module loading for folder plugin packages
- [x] Add desktop external frontend zip source discovery + loading
- [x] Harden duplicate plugin id handling between internal and external desktop manifests
- [x] Remove desktop/frontend zip flow OS shell dependency (in-process zip handling for runtime + tests)
- [x] Add backend plugin module scaffold for external dual-target dev probe package (`backend-plugin-devprobe`)
- [x] Add scripted dev workflow for external dev probe staging/watch/run integration
- [ ] Add compatibility checks for TS/Java contract drift
- [ ] Add decision log for plugin discovery mechanism (ServiceLoader vs explicit scan)
- [ ] Complete package move physically to subdirectories for `backend-contract` (currently package names updated)

## Desktop-side companion track (file entity / workspace / file watcher)

The Java backend's `file.*` protocol surface and `FileRegistry`/`FileSessionHandler` SPI exist to be consumed by the renderer. The companion desktop work landed in parallel:

- `core.files` plugin owns the renderer `FileRegistry` + `FileMediator`.
- `core.fileWatcher` plugin runs chokidar in Electron main with dedup + ref-count + active per-URI mute timers.
- `core.workspace` plugin persists session to `<userData>/workspace.json` (atomic, debounced); autosaves dirty buffers to `<userData>/backups/`; detects surviving backups on restart (crash recovery API).
- See `queryeer-desktop/documentation/{FILE_ENTITY_MODEL,CORE_FILE_WATCHER_MODEL,CORE_WORKSPACE_MODEL,PROCESS_BOUNDARIES}.md`.

No engine plugin implements `FileSessionHandler` yet — the SPI is ready, but parse-tree reuse is deferred until an editor + output plugin land to drive real query flow.

## Current blockers / decisions

- Discovery direction selected: manifest-first folder/zip discovery with per-plugin classloaders.
- Core boundary decision recorded: querying/engine/output behavior is external-plugin owned; core remains host/platform boundary.
- Desktop boundary enforcement now uses fully external dev probe package scaffold (`plugins/dev-query-probe`) with backend companion module (`backend-plugin-devprobe`).
- Decision pending: whether to keep built-in fallback registration after external discovery is productionized.
- Decision pending: JSON serialization stack and strict schema validation approach.
- Decision pending: final Java style baseline (currently Google Java Format + lightweight Checkstyle rules).
