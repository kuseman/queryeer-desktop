# Core Settings Implementation Plan

Status: approved pre-implementation plan  
Date: 2026-04-25

## 1. Objectives

Build `core.settings` as the single settings authority with:

- Settings contribution registry
- Settings modal foundation (search + tree + details panel)
- Persisted settings load/save
- Declaration-first settings model with optional advanced hooks

## 2. Locked Architectural Constraints

- `core.settings` is backend-agnostic.
- `core.settings` owns settings persistence and retrieval.
- Modules contribute schemas and react to setting changes.
- If settings must be sent to Java backend, that is a module-level implementation detail.
- Save strategy: auto-apply in memory + debounced atomic persist.
- Scope for v1: single workspace application scope.
- Secret handling in this session: Option B (non-editable placeholder; no secret persistence implementation).

## 3. Storage Strategy (Hybrid)

Use a hybrid persistence model:

- `settings/index.json`  
  Canonical metadata and module file index.
- `settings/<moduleId>.json`  
  Module-scoped persisted values.

### Example

```json
{
  "version": 1,
  "updatedAt": "2026-04-25T12:00:00.000Z",
  "modules": {
    "core.editor": { "file": "core.editor.json", "version": 1, "updatedAt": "..." }
  }
}
```

```json
{
  "version": 1,
  "moduleId": "core.editor",
  "updatedAt": "2026-04-25T12:00:00.000Z",
  "values": {
    "core.editor.tabSize": 2
  }
}
```

## 4. Contribution Model

Declaration-first, with optional advanced behavior:

- Tier 1: declarative settings (`boolean|string|number|enum|json`)
- Tier 2: advanced extension hooks (custom renderer/validator)

Guardrails:

- Advanced settings must still include declarative metadata.
- Persistence path and write control remain in `core.settings`.
- Setting ownership rule enforced: `setting.id` must start with `${moduleId}.`.

## 5. Implementation Plan (Execution Order)

1. Contracts + extension registry wiring
   - Add settings extension contracts
   - Extend `PluginContext` with `settings`
   - Extend runtime registry wiring in `ExtensionRegistry`

2. Main-process settings store
   - Add `SettingsStore` with hybrid index/module persistence
   - Debounced atomic writes and corruption handling

3. IPC + preload + shell API
   - Main IPC handlers
   - Preload bridge methods
   - Shell API contract updates

4. Renderer settings service
   - Contribution registration
   - Default + persisted value resolution
   - `get/set/subscribe/search/tree` APIs
   - Debounced persistence orchestration

5. `core.settings` plugin + modal UI foundation
   - Command/menu/keybinding to open modal
   - Search box, section tree, selected-setting panel
   - Default editors for primitive/enum settings
   - Secret placeholder rendering (Option B)

6. Plugin discovery integration
   - Add `core.settings` manifest
   - Register in manifest loader and discovery module map

7. Advanced hooks
   - Register advanced renderers/validators
   - Ensure declarative fallback and indexing still work

8. Documentation + handoff
   - Add `CORE_SETTINGS_MODEL.md`
   - Update `SESSION_HANDOFF.md` with known gaps and rationale

## 6. Test-First Plan

### Unit tests (minimum bar)

- Store tests:
  - Missing files
  - Read/write index + module docs
  - Debounced writes
  - Atomic temp+rename behavior
  - Corrupt file quarantine fallback

- Settings service tests:
  - Registration + ownership validation
  - Default resolution + overrides
  - Search behavior
  - Tree grouping
  - Subscription notifications

- UI tests:
  - Search filtering
  - Tree selection
  - Details editor updates
  - Secret placeholder behavior
  - Advanced renderer fallback

### Integration tests (where feasible)

- Bootstrap/discovery includes `core.settings`
- Open settings command brings modal foundation up

## 7. Validation Checklist

Run and report:

- Desktop:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run test:integration`

- Backend:
  - `./mvnw -f queryeer-backend/pom.xml -DskipTests=true clean verify`

## 8. Non-Goals (This Session)

- OS keychain / real secret store implementation
- Backend-side settings orchestration in `core.settings`
- Multi-scope settings merge (user/workspace/global layering)

## 9. Known Gaps / Deferred Items

- Secret persistence and retrieval implementation deferred (placeholder UI only).
- Scope layering deferred (single workspace scope only).
- Complex advanced setting action workflows may start with minimal hook surface and expand incrementally.
