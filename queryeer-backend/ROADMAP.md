# Queryeer Backend Roadmap

## Progress tracker

## backend-api

- [x] Initial plugin SPI scaffold (`BackendPlugin`, `BackendPluginContext`, descriptors)
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

## backend-core

- [x] Initial runtime + unique-id validation scaffold
- [x] Add dependency validation
- [x] Add capability validation
- [x] Add activation/deactivation lifecycle orchestration
- [x] Add plugin status model (`loaded`, `failed`, `skipped`)
- [x] Add default platform service implementations and composed plugin context
- [x] Add architecture tests for runtime lifecycle/wiring behavior

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

## backend-plugin-jdbc

- [x] Initial plugin scaffold and engine registration placeholder
- [ ] Implement real JDBC adapter integration

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

## Current blockers / decisions

- Discovery direction selected: manifest-first folder/zip discovery with per-plugin classloaders.
- Core boundary decision recorded: querying/engine/output behavior is external-plugin owned; core remains host/platform boundary.
- Desktop boundary enforcement now uses fully external dev probe package scaffold (`plugins/dev-query-probe`) with backend companion module (`backend-plugin-devprobe`).
- Decision pending: whether to keep built-in fallback registration after external discovery is productionized.
- Decision pending: JSON serialization stack and strict schema validation approach.
- Decision pending: final Java style baseline (currently Google Java Format + lightweight Checkstyle rules).
