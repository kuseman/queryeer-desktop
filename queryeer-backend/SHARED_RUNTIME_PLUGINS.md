# Shared Runtime Plugins and Parent-First Delegation

## Background

We hit two classloader/runtime issues that are related:

1. SQL Server integrated authentication worked in one plugin path but failed in another (`This driver is not configured for integrated authentication`).
2. Shared runtime behavior (native libraries + selected Java packages) was not centrally declared, so fixes were ad-hoc.

The immediate workaround is in place:

- Parent startup preloads SQL Server auth DLLs from `libNative`.
- Plugin classloaders now delegate `com.microsoft.sqlserver.jdbc.*` parent-first.
- SQL Server URL for native auth includes explicit `authenticationScheme=NativeAuthentication`.

This document defines the longer-term solution.

## Problem Statement

Some libraries must be treated as process-wide/runtime-shared instead of plugin-local:

- JDBC drivers with native dependencies (for example `mssql-jdbc` + `mssql-jdbc_auth*.dll`).
- Libraries where class identity must be shared across plugins.
- Packages that must resolve from the shared/parent loader to avoid split runtime state.

Today, parent-first package rules are hardcoded in `PluginClassLoaderFactory`, and native loading rules are hardcoded in startup logic.

## Goal

Introduce **shared-runtime plugins** that can contribute runtime requirements in a declarative way:

- parent-first package prefixes
- shared JAR requirements
- native library preload requirements

The runner aggregates these contributions before plugin activation and applies them once, centrally.

## Proposed Design

### 1) New runtime contribution model

Add a descriptor model consumed by `backend-runner`, for example:

- `SharedRuntimeContribution`
  - `id`
  - `parentFirstPackagePrefixes` (list of strings)
  - `nativeLibraries` (list of preload specs)
  - `sharedArtifacts` (optional metadata for expected jars)
  - `priority` (integer; lower loads first)

Native preload spec example fields:

- `os` (`windows`, `linux`, `macos`, or `any`)
- `arch` (`x64`, `arm64`, or `any`)
- `searchPaths` (relative to app dir, default `libNative`)
- `filePatterns` (for example `mssql-jdbc_auth*.dll`)
- `required` (fail startup if missing vs warn-only)

### 2) How plugins contribute

Allow plugin manifests to include a runtime block (shape can be refined):

```yaml
runtime:
  shared:
    parentFirstPackagePrefixes:
      - com.microsoft.sqlserver.jdbc.
    nativeLibraries:
      - os: windows
        arch: x64
        searchPaths: [libNative]
        filePatterns: [mssql-jdbc_auth*.dll, sqljdbc_auth.dll]
        required: false
```

Only trusted/builtin plugins should be allowed to contribute parent-first/native rules.

### 3) Runner startup sequence

1. Discover manifests (builtin + external as configured).
2. Collect all shared-runtime contributions from trusted sources.
3. Merge + validate contributions:
   - deduplicate prefixes
   - validate package prefix format
   - validate native pattern safety
4. Build `SharedClassLoader` from `libShared`.
5. Build `ParentAwarePluginClassLoader` with merged parent-first prefixes.
6. Preload native libraries in parent scope using absolute paths.
7. Activate plugins.

### 4) Parent-first rule handling

- Start with current built-ins (`java.*`, `javax.*`, `com.queryeer.backend.api.*`, etc.).
- Append contributed prefixes.
- Keep deterministic order for reproducibility (built-ins first, then contributed sorted by plugin id + declared order).

### 5) Native library handling

- Load by absolute path via `System.load(...)`, not by `loadLibrary` name lookup.
- Log each attempt with plugin correlation and resulting path.
- If already loaded, log and continue.
- For `required=true`, fail startup with a clear error.

## SQL Server Reference Profile

For SQL Server integrated auth, the shared runtime contribution should include:

- parent-first prefix: `com.microsoft.sqlserver.jdbc.`
- native patterns: `mssql-jdbc_auth*.dll`, `sqljdbc_auth.dll` (Windows)
- shared jar in `libShared`: `mssql-jdbc-*.jar`

And URL generation for native auth should remain explicit:

- `integratedSecurity=true`
- `authenticationScheme=NativeAuthentication`

## Security and Governance

- Only allow runtime contributions from builtin plugins by default.
- If external contributions are allowed later, gate behind explicit config and signature/trust checks.
- Reject wildcard parent-first prefixes like `com.` or empty values.
- Restrict native search paths to app-owned directories.

## Migration Plan

1. Keep current hardcoded SQL Server workaround as compatibility fallback.
2. Implement contribution model and startup aggregation.
3. Move SQL Server-specific parent-first/native rules from hardcoded code to contribution config.
4. Remove hardcoded rule once contribution path is proven in CI and manual smoke tests.

## Acceptance Criteria

- Payloadbuilder JDBC catalog and JDBC plugin both succeed with SQL Server native integrated auth using same backend runtime.
- No plugin-local SQL Server driver class is used when parent-first contribution is enabled.
- Missing native binaries produce actionable startup logs.
- Parent-first prefix list is visible in runtime summary/logging.
- Existing non-SQL plugins continue to load without behavior regressions.
