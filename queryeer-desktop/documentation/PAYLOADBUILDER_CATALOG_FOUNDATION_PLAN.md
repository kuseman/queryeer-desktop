# Payloadbuilder Catalog Extension Foundation Plan

Status: In progress
Scope: Build payloadbuilder-specific catalog configuration foundation with frontend/backend coordination, while keeping core protocol generic and reusable for future engines.

## Guardrails

- [x] Alias uniqueness is enforced per file (not global)
- [x] Core protocol remains engine-agnostic (no payloadbuilder-specific method/shape in core contracts)
- [ ] Use generic core fields:
  - [x] `queryengine.execute.engineState?: unknown`
  - [x] `queryengine.completed.engineStatePatch?: unknown`
- [x] Payloadbuilder-specific state persists in `FileEntity.persistentViewState["payloadbuilder.catalogs"]`
- [ ] Every contract change updates both:
  - [x] `queryeer-desktop/src/contracts/backend/*`
  - [x] `queryeer-backend/backend-contract/*`
- [ ] Protocol docs updated:
  - [x] `queryeer-desktop/documentation/BACKEND_PROTOCOL.md`

---

## Phase 1: Core Contract (Minimal, Generic)

### 1.1 TypeScript contract updates
- [x] Add `engineState?: unknown` to `QueryExecuteParams`
- [x] Add `engineStatePatch?: unknown` to `QueryCompletedNotification`
- [ ] Ensure method maps and capabilities remain coherent in:
  - [x] `queryeer-desktop/src/contracts/backend/Types.ts`
  - [x] `queryeer-desktop/src/contracts/backend/Methods.ts` (only if needed)
  - [x] related contract exports/index files

### 1.2 Java contract updates
- [x] Add `Object engineState` to `QueryExecuteParams` record
- [x] Add `Object engineStatePatch` to `QueryCompletedNotification` record
- [x] Keep serialization/backward compatibility behavior acceptable

### 1.3 Protocol docs and fixtures
- [x] Update `BACKEND_PROTOCOL.md` with generic engine state flow
- [ ] Update protocol fixtures in `protocol-fixtures/backend/*`:
  - [x] request-query-execute fixture includes `engineState`
  - [x] notification-query-completed fixture includes `engineStatePatch`
- [x] Update/verify `ProtocolFixtureCompatibilityTest`

### 1.4 Tests
- [ ] Desktop contract/gateway tests for passthrough of unknown blob
- [x] Backend contract fixture tests pass with new fields

---

## Phase 2: Payloadbuilder Frontend State Foundation

### 2.1 Persistent model (versioned)
- [x] Define payloadbuilder persisted state schema:
  - [ ] key: `payloadbuilder.catalogs`
  - [ ] shape:
    - [x] `schemaVersion: 1`
    - [x] `instancesByAlias: Record<string, { catalogId: string; properties: Record<string, unknown> }>`
- [x] Add parser/normalizer that:
  - [x] validates structure
  - [x] preserves unknown fields where possible
  - [ ] supports future migration hooks

### 2.2 Store/reducer/service
- [x] Create file-scoped catalog state store for active file
- [ ] Add actions:
  - [x] upsert instance by alias (internal/state parser support)
  - [x] remove alias (internal/patch support)
  - [x] set property
  - [x] apply backend patch
- [x] Validate alias:
  - [x] required
  - [x] trimmed
  - [x] non-empty
  - [x] unique per file

### 2.3 Persistence wiring
- [x] Load from `file.persistentViewState["payloadbuilder.catalogs"]`
- [x] Persist updates back to `persistentViewState` without clobbering other keys
- [x] Ensure behavior is isolated per file/tab

### 2.4 Tests
- [x] Unit tests for schema parse/migrate
- [x] Unit tests for alias validation and uniqueness
- [x] Unit tests for per-file isolation and persistence roundtrip

---

## Phase 3: Payloadbuilder Sidebar Host + Contribution Model

### 3.1 Base host UI
- [x] Register payloadbuilder catalog host view in primary sidebar
- [x] Render one panel per alias instance
- [x] Display panel title with alias + catalog label

### 3.2 Contribution API (payloadbuilder module-local)
- [x] Define catalog type contribution contract:
  - [ ] `catalogId`
  - [ ] presentation metadata
  - [ ] panel renderer
  - [ ] optional operation bindings
- [x] Ensure multiple aliases of same `catalogId` render independently

### 3.3 Tests
- [x] Host render tests (panel count/order)
- [x] Correct panel-to-alias binding tests

---

## Phase 4: Execute Flow Integration (Frontend)

### 4.1 Query assembly
- [x] Extend payloadbuilder execute path to include `engineState`
- [x] Build `engineState` from file's `payloadbuilder.catalogs` state
- [x] Keep deterministic ordering (stable serialization for testability)

### 4.2 Completion reconciliation
- [x] On `queryengine.completed`, inspect `engineStatePatch`
- [x] Apply patch into store
- [x] Persist merged state to `persistentViewState`
- [x] Trigger UI updates for affected alias panels

### 4.3 Tests
- [x] Integration-style test: state -> execute payload includes engineState
- [x] Integration-style test: completed patch -> state/persistence/UI update

---

## Phase 5: Backend Payloadbuilder Foundation

### 5.1 Engine-state adapter (payloadbuilder plugin)
- [x] Parse `engineState` blob into payloadbuilder domain model
- [x] Validate alias/catalogId/properties shape
- [x] Gracefully handle malformed state (fail fast with clear error or ignore invalid sections per policy)

### 5.2 QuerySession application pipeline
- [x] Apply incoming alias-scoped properties to `QuerySession` before execution
- [ ] Snapshot pre-execution input state
- [ ] Snapshot post-execution effective state
- [x] Diff and emit `engineStatePatch` for changed aliases/properties only

### 5.3 Hook execution notifications
- [x] Ensure `queryengine.completed` includes `engineStatePatch` when non-empty
- [x] Keep non-payloadbuilder engines unaffected

### 5.4 Tests
- [x] Unit tests for apply/snapshot/diff
- [x] Provider/service tests for completion patch emission
- [x] Negative tests for malformed `engineState`

---

## Phase 6: Optional Engine Operations Channel (Only If Needed)

Do this only when catalog UI needs backend calls (eg list indices/databases).

- [x] Add generic core method `engine.invoke`:
  - [x] request: `{ engineId, fileId, action, payload }`
  - [x] response: `{ result?: unknown }` (or agreed generic envelope)
- [x] Route in frontend gateway/preload
- [x] Route in backend request handling
- [x] Implement payloadbuilder handler for catalog operations (alias-aware via payload)
- [x] Tests for invoke request/response and error handling

---

## Phase 7: First Vertical Slice (Payloadbuilder Catalog)

- [x] Implement one concrete catalog contribution end-to-end (eg Elasticsearch or JDBC-within-payloadbuilder)
- [x] Support multiple aliases for same catalog type
- [x] Support one async backend operation from panel
- [x] Validate full loop:
  - [x] UI edit persists in file state
  - [x] execute sends engineState
  - [x] backend applies to session
  - [x] backend patch updates UI state after completion

---

## Definition of Done

- [x] Per-file payloadbuilder catalog state is persisted and restored
- [x] Alias is mandatory and unique per file
- [x] Execute request carries generic `engineState` blob
- [x] Backend payloadbuilder applies catalog properties before execution
- [x] Backend can return post-execution mutations via `engineStatePatch`
- [x] Frontend reconciles and persists patch updates
- [x] Core protocol remains engine-agnostic and reusable for future engines
- [x] TS + Java contracts + protocol docs + fixtures are synchronized
- [x] Required validation commands run and reported

---

## Validation Checklist

### Desktop (`queryeer-desktop`)
- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm run test:integration`

### Backend (`queryeer-backend`)
- [x] `./mvnw -f queryeer-backend/pom.xml -DskipTests=true clean verify`

---

## Session Handoff Template (for multi-session continuity)

### Completed this session
- [x] Core protocol generalized with `engineState`/`engineStatePatch` in TS + Java contracts.
- [x] Added payloadbuilder-specific frontend plugin module (separate from `core.queryengine`).
- [x] Added settings-driven alias-to-catalog mapping contribution in `core.queryengine.payloadbuilder`.
- [x] Added payloadbuilder backend engine-state adapter and `QuerySession` apply/diff flow.
- [x] Updated protocol docs and fixtures with compatibility tests.
- [x] Added payloadbuilder plugin integration tests for execute `engineState` and `queryengine.completed` patch reconciliation.
- [x] Added payloadbuilder store tests for enabled filtering and configured alias ordering.
- [x] Added backend payloadbuilder tests for engine-state apply/diff and malformed-state validation failures.
- [x] Added payloadbuilder sidebar host tests for panel ordering and alias-to-panel bindings.
- [x] Added generic `engine.invoke` contracts plus frontend/backend routing and payloadbuilder invoke actions.
- [x] Added invoke end-to-end tests across gateway, integration, contract fixtures, and transport/provider modules.

### In progress
- [x] Replace temporary generic catalog panel with concrete catalog contributors (Elasticsearch/Jdbc/etc.).

### Next immediate steps
1. Extend invoke action set for completion/schema lookup and other engine-specific operations.
2. Add additional catalog providers (Jdbc/Http) using shared provider registry.
3. Add integration coverage for successful remote index fetch against a mocked HTTP endpoint.

### Known gaps / temporary scaffolds
- [x] Backend patch diff currently evaluates only keys supplied in input `engineState`; new backend-introduced keys are not discovered yet.

### Files touched
- [x] `queryeer-desktop/src/plugins/core.queryengine.payloadbuilder/*`
- [x] `queryeer-backend/backend-plugin-payloadbuilder/*`
- [x] `queryeer-desktop/documentation/BACKEND_PROTOCOL.md`

### Test results
- [x] `npm run typecheck` (pass)
- [x] `npm run lint -- src/plugins/core.queryengine.payloadbuilder src/plugins/core.queryengine src/plugins/discovery.ts src/plugins/manifest-loader.ts` (pass)
- [x] `npm run test -- src/plugins/core.queryengine.payloadbuilder/catalog-state.test.ts src/plugins/core.queryengine.payloadbuilder/catalog-store.test.ts src/plugins/core.queryengine.payloadbuilder/catalog-settings.test.ts` (pass)
- [x] `npm run test -- src/plugins/core.queryengine.payloadbuilder/catalog-state.test.ts src/plugins/core.queryengine.payloadbuilder/catalog-store.test.ts src/plugins/core.queryengine.payloadbuilder/catalog-settings.test.ts src/plugins/core.queryengine.payloadbuilder/plugin.integration.test.ts` (pass)
- [x] `npm run test -- src/plugins/core.queryengine.payloadbuilder/PayloadbuilderCatalogSidebar.test.tsx src/plugins/core.queryengine.payloadbuilder/plugin.integration.test.ts src/plugins/core.queryengine.payloadbuilder/catalog-store.test.ts src/plugins/core.queryengine.payloadbuilder/catalog-settings.test.ts src/plugins/core.queryengine.payloadbuilder/catalog-state.test.ts` (pass)
- [x] `npm run test -- src/plugins/core.queryengine.payloadbuilder/CatalogInstancesSettingsEditor.test.tsx src/plugins/core.queryengine.payloadbuilder/default-catalog-contribution.test.tsx src/plugins/core.queryengine.payloadbuilder/catalog-store.test.ts src/plugins/core.queryengine.payloadbuilder/plugin.integration.test.ts src/plugins/core.queryengine.payloadbuilder/PayloadbuilderCatalogSidebar.test.tsx` (pass)
- [x] `npm run test -- src/main/backend/backend-gateway.test.ts` (pass)
- [x] `npm run lint -- src/plugins/core.queryengine.payloadbuilder` (pass)
- [x] `npx eslint "src/plugins/core.queryengine.payloadbuilder/**/*.{ts,tsx}" "src/plugins/core.settings/**/*.{ts,tsx}"` (pass)
- [x] `npm run build` (pass)
- [x] `npm run test:integration` (pass; 8 passed, 2 skipped)
- [x] `npm run test:protocol-fixtures` (pass)
- [x] `./mvnw -f queryeer-backend/backend-plugin-payloadbuilder/pom.xml test` (pass; 10 tests)
- [x] `./mvnw -f queryeer-backend/backend-transport-stdio/pom.xml test` (pass; 15 tests)
- [x] `./mvnw -f queryeer-backend/backend-contract/pom.xml test` (pass; 17 tests)
- [x] `./mvnw -f queryeer-backend/pom.xml -DskipTests=true clean verify` (pass)
