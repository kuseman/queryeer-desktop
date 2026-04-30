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

### Validation rules

- Fail fast with explicit errors when `deps-list.txt` is missing.
- Fail fast when listed jar paths do not exist.
- Restrict to dev mode only; distribution packaging continues to use plugin-local `lib/*.jar`.

### Why this baseline

- Enables running plugin modules directly from compiled classes without building full distribution bundles.
- Keeps plugin boundary/classloader behavior identical to production logic.
- Reduces migration friction while still enforcing manifest-driven loading.
