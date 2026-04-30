# Query Engine Plugin Migration Plan

Status: in progress (break-friendly reset allowed)

## Goal

Move query engine concerns out of core host wiring and into explicit plugin and library modules with predictable isolation and dependency rules.

## Target shape

- Host/core modules:
  - `backend-api`
  - `backend-core`
  - `backend-runner`
- Query engine modules:
  - `backend-plugin-payloadbuilder`
  - `backend-plugin-jdbc`
  - `backend-plugin-queryengine-payloadbuilder-jdbc`
- Planned next modules:
  - `backend-lib-queryengine-jdbc-foundation` (shared library, not runtime plugin)

## Architecture rules

- One plugin = one classloader.
- No hierarchical plugin classloaders.
- Parent classloader resolves API/contract namespaces only.
- Plugin collaboration happens via plugin dependencies and capabilities, not direct implementation-class imports.
- Shared cross-plugin types must live in API modules.

## Capability map (initial)

- `query.payloadbuilder` provides:
  - `queryengine.execute`
  - `engine.invoke`
  - `queryengine.payloadbuilder.catalog`
- `query.jdbc` provides:
  - `queryengine.execute`
  - `queryengine.jdbc.connection`
- `query.payloadbuilder.jdbc` requires:
  - `queryengine.payloadbuilder.catalog`
  - `queryengine.jdbc.connection`
- `query.payloadbuilder.jdbc` provides:
  - `queryengine.payloadbuilder.jdbc.bridge`

## Rollout phases

1. Add bridge plugin module and register descriptor dependencies/capabilities.
2. Move runner startup toward manifest-first plugin bootstrap for all plugins.
3. Introduce explicit classloader parent-first namespace allowlist.
4. Extract JDBC shared internals into a non-plugin foundation library.
5. Move remaining query-engine-specific wiring out of core bootstrap paths.

## What has started in this session

- Added module `backend-plugin-queryengine-payloadbuilder-jdbc`.
- Added plugin class `PayloadbuilderJdbcBackendPlugin` with explicit dependencies and capabilities.
- Added focused unit test for descriptor contract.
- Switched builtin runner startup from direct plugin instantiation to manifest-backed plugin factory instantiation.
- Added `BuiltinPluginDiscoveryTest` to pin builtin plugin discovery order/dependencies.
- Added classloader policy in `PluginClasspathFactory`:
  - parent-first for `com.queryeer.backend.api.*`, `com.queryeer.backend.contract.*`, and JDK namespaces.
  - child-first for plugin-private namespaces.
- Added `PluginClasspathFactoryTest` to assert parent API class identity and child-first behavior for shadowed plugin classes.

## Next concrete changes

- Add bridge manifest packaging and load path for external plugin discovery.
- Add classloader isolation tests for API boundary class identity.
- Remove hardcoded runner builtins after manifest-only loading is in place.

## Dev-mode baseline before full externalization

To keep iteration speed high while migrating builtins to fully external plugins, adopt a dev-only classpath manifest mode.

### Plugin folder shape (dev)

- `plugin.json`
- `classes/` (compiled plugin module classes)
- `deps-list.txt` (one absolute jar path per line, typically from `~/.m2`)

### Manifest shape (dev)

Use existing backend classpath fields:

- `backend.classpath.root: "."`
- `backend.classpath.include: ["classes", "@deps-list.txt"]`

The `@` prefix means "expand entries from this list file".

### Generation strategy

- Use `maven-dependency-plugin` to emit dependency jar paths to `deps-list.txt`.
- Keep paths absolute in dev mode for simplicity and speed.

### Loader behavior

- If `backend.classpath` is present, resolve from manifest instead of default `source + lib/*.jar`.
- Add `classes/` directory URL first, then jars from list files.
- Keep current parent-first policy for API/contracts and child-first for plugin-private classes.

Implementation status: implemented in backend runner classpath resolution (`PluginClasspathFactory`) with list-file expansion support.

### Validation rules

- Fail fast with explicit errors when `deps-list.txt` is missing.
- Fail fast when listed jar paths do not exist.
- Restrict to dev mode only; distribution packaging continues to use plugin-local `lib/*.jar`.

Implementation status: manifest/classpath validation and missing-entry errors are now enforced in backend runner (`PluginManifestValidation`, `PluginClasspathFactory`).

Implementation status: a repository probe plugin exists under `plugins/dev-classpath-probe` with staging script `queryeer-desktop/scripts/dev-classpath-probe-stage.mjs`.

### Why this baseline

- Enables running plugin modules directly from compiled classes without building full distribution bundles.
- Keeps plugin boundary/classloader behavior identical to production logic.
- Reduces migration friction while still enforcing manifest-driven loading.

## Phase 2 formalization: mixed discovery mode

Status: completed (mode plumbing + validation guardrails in place)

### Decision

- Use a transition mode where runner discovery includes both builtin manifests and external plugin folders.
- Keep external-only as the end-state target after packaging/bootstrap is complete and proven in CI.

### Objective

- Stabilize the migration by preserving runtime continuity while enforcing explicit plugin identity, source visibility, and conflict rules.

### Scope

- Introduce explicit discovery mode semantics in runner startup:
  - `builtin`: builtin manifests only.
  - `external`: external plugin path only.
  - `mixed`: builtin + external together.
  - `auto`: current compatibility behavior, mapped to deterministic mode selection.
- Define deterministic plugin conflict policy for mixed mode.
- Add diagnostics so runtime status and logs expose plugin source and resolution decisions.

### Required behavior

- Discovery mode is configurable and logged at startup.
- In mixed mode, duplicate plugin ids across sources fail fast by default with actionable error messages.
- Optional override policy can be introduced later; default remains strict-fail to avoid accidental shadowing.
- Runtime status output includes per-plugin source metadata (`builtin` vs `external`) for troubleshooting.

Implementation status: discovery mode plumbing is implemented in backend runner with modes `auto`, `builtin`, `external`, `mixed` and strict duplicate-id failure in mixed mode.
Implementation status: backend-runner tests now cover mode parsing, mode planning (`auto` effective behavior), and mixed-mode duplicate-id merge failure.

### Configuration keys and defaults

- Discovery mode selectors (property takes precedence over env):
  - system property: `queryeer.plugins.mode`
  - environment variable: `QUERYEER_PLUGINS_MODE`
- Supported mode values (case-insensitive):
  - `auto`
  - `builtin`
  - `external`
  - `mixed`
- Plugin path selectors (property takes precedence over env):
  - system property: `queryeer.plugins.path`
  - environment variable: `QUERYEER_PLUGINS_PATH`
- Default behavior when mode is unset:
  - mode defaults to `auto`
  - `auto` resolves to:
    - external discovery if plugin path is provided
    - builtin discovery if plugin path is not provided
- Mode/path constraints:
  - `external` requires plugin path
  - `mixed` requires plugin path
  - `builtin` ignores plugin path

### Testing and validation

- Unit tests:
  - mode selection and fallback behavior (`auto`, `builtin`, `external`, `mixed`).
  - duplicate-id detection across sources.
  - source metadata propagation into runtime status model.
- Integration tests:
  - mixed mode startup with both builtin and external probe plugins.
  - expected startup failure on deliberate duplicate-id fixture.
- CI:
  - keep `npm run dev:classpath:probe:smoke` in pipeline.
  - ensure existing integration suite still passes under default mode.

### Exit criteria for moving to external-only

- All current builtin plugins are packaged and loadable as external plugins.
- Release packaging reliably includes required plugin bundles.
- CI green for at least two consecutive runs with external-first validation.
- No unresolved plugin source conflict issues in mixed mode telemetry/logs.

### Non-goals in Phase 2

- No immediate removal of builtin plugin definitions.
- No broad plugin packaging redesign beyond what is needed for mode clarity and conflict safety.
