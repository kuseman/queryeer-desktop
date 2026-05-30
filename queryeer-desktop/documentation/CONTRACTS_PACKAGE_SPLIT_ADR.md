# ADR: Extract `src/contracts` into a standalone `@queryeer/api` workspace package

**Status:** Proposed  
**Date:** 2026-05-30  
**Deciders:** @marhen105

---

## Context

The `queryeer-desktop` frontend has grown to contain ~35+ plugin directories, core logic, renderer code, and a `src/contracts/` directory that holds the shared type definitions, extension-point interfaces, and data shapes used across all plugins and core modules.

Over time the following problems emerged:

1. **No explicit boundary** — plugins can import from any internal module, blurring the public API surface.
2. **Impossible to publish contracts independently** — downstream consumers (e.g. a future SDK, external plugins, or tooling) cannot consume the types without pulling the entire repo.
3. **Accidental coupling** — contract files sometimes accumulated runtime dependencies on Electron or renderer internals.
4. **Java backend mirroring is manual** — the `backend-contract` module in the Java tree maintains parallel type definitions with no shared source of truth.

The contracts folder was recently swept to eliminate all runtime Electron/renderer dependencies, leaving it as a pure TypeScript type-and-interface library with a single external peer dependency on `react` (used only for `import type` of `ComponentType`, `ReactNode`, and `JSX`).

---

## Decision

Split the `queryeer-desktop` repository into a **workspace monorepo** with two packages:

```
queryeer-desktop/
├── package.json              # Root workspace config
├── tsconfig.base.json        # Shared TS base config
├── packages/
│   ├── api/                  # @queryeer/api  — pure TypeScript contracts
│   └── app/                  # @queryeer/app  — the Electron application
```

### Package responsibilities

| Package | Directory | npm name | Contents |
|---|---|---|---|
| **api** | `packages/api` | `@queryeer/api` | All of `src/contracts/` — types, interfaces, enums, constants, extension-point definitions. Zero runtime code, zero Electron imports. |
| **app** | `packages/app` | `@queryeer/app` | Everything else: plugins, core runtime, renderer, main process, preload. Depends on `@queryeer/api` via workspace reference. |

### API package details

- Source: `packages/api/src/` (one-to-one mapping from current `src/contracts/`)
- Build: `tsc` emitting `./dist/` with `declaration: true` and `declarationMap: true`
  - Input: `src/**/*.ts`
  - Output: `dist/` with JS + `.d.ts` + `.d.ts.map`
  - Module: `NodeNext` (preserving `.js` extensions in output)
- Entry point: `src/index.ts` that re-exports everything from the subdirectories
- `publishConfig`: `{ "access": "public" }` — required because `@queryeer/` is a scoped package
- Dependencies:
  - `react` as a `peerDependency` (type-only usage; consumers already depend on it)
  - No runtime dependencies

### App package changes

- `packages/app/package.json` adds `"@queryeer/api": "workspace:*"` under `dependencies`
- `packages/app/tsconfig.json` adds `"paths": { "@queryeer/api": ["../api/src"] }` for local development
- All import paths currently pointing to `src/contracts/...` become `from "@queryeer/api"` or `from "@queryeer/api/flow/FlowDocument.js"` for deep imports
- Build remains `electron-vite` (unchanged)
- The `contracts` module resolution override in the existing Vite config is no longer needed

### Development experience

`npm run dev` continues to work as a single command with no extra ceremony:

- The `electron-vite` config in `app/` resolves `@queryeer/api` directly to `packages/api/src/` via a Vite resolve alias. Vite compiles the TypeScript on-the-fly, so there is **no separate `tsc --watch` step** for the API package during development. The developer experience is identical to today.
- For type checking in the editor, the `tsconfig.json` `paths` mapping ensures IDE navigation, autocompletion, and diagnostics work without a prior build step.
- A production build runs `tsc` in `api/` first (emitting `dist/` with declarations), then `electron-vite` in `app/` (resolving to the compiled output via the `workspace:*` link instead of the alias).

### Root workspace

- `queryeer-desktop/package.json` adds `"workspaces": ["packages/*"]`
- A root `tsconfig.base.json` holds the shared TypeScript configuration (`strict: true`, `moduleResolution: nodenext`, etc.)
- Top-level scripts (`build`, `lint`, `test`) delegate to `packages/app` via `npm run -w @queryeer/app`

---

## Consequences

### Positive

1. **Clear public API surface** — `@queryeer/api` is the only allowed import target for external consumers. Internal app code that needs contracts must go through the published package, preventing incidental coupling.
2. **Independent versioning & publishing** — the API package can be versioned, published to a registry, and consumed by external plugins, tooling, or documentation generators.
3. **Faster CI** — `@queryeer/api` can be built and tested independently of the Electron app (no `electron-vite`, no renderer compilation).
4. **Faster editor experience** — IDEs resolve cross-package references with workspace-accelerated type checking.
5. **Single source of truth for Java mirroring** — the Java `backend-contract` module can derive its types from the published npm package via a codegen step (future work).

### Negative

1. **Migration cost** — all existing imports from `src/contracts/...` must be updated to `@queryeer/api` (estimated ~100-150 import sites across ~50 files). Tooling (codemod/sed) can handle this in one pass.
2. **Production build orchestration** — CI must run `api` build (`tsc`) before `app` build (`electron-vite`). Simple `npm run build` in the root workspace handles ordering, but adds ~10s to pipeline time.
3. **Workspace overhead** — npm workspaces add subtle constraints (hoisting behavior, lifecycle ordering). Lockstep versioning (`api` + `app` always released together) avoids most issues but means `api` cannot be patched independently of an `app` release.

### Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `react` peer version drift | Pin to the major version used by `app`; Dependabot alerts will catch mismatches |
| Workspace hoisting breaks plugin resolution | Use `nohoist` in root `package.json` for any package that needs local copies |
| External consumers need runtime helpers | The API package deliberately ships no runtime code; if needed later, add dependency thoughtfully |

---

## Alternatives Considered

### 1. Keep `src/contracts` in-app (status quo)
Rejected because there is no enforced API boundary and no path to independent publishing.

### 2. Extract to a separate repository
Rejected — adds cross-repo coordination overhead for version bumps, CI pipelines, and local development. A workspace monorepo keeps everything in one checkout with atomic commits.

### 3. Publish `src/contracts` directly from its current location (no workspace)
Rejected — the workspace structure is necessary for local resolution during development. Publishing directly from an in-source path would require complex prepublish scripts and confuse consumers.

### 4. Use a different build tool for `api` (`tsup`, `microbundle`, `vite`)
Rejected for now — bare `tsc` is the simplest option with zero configuration overhead. If tree-shaking or bundle size become a concern, migrate to `tsup` later.

---

## Future Considerations

- **Java codegen** — once `@queryeer/api` is published, explore generating Java POJOs in `backend-contract` from the TypeScript declarations.
- **External plugin SDK** — the API package forms the foundation of a future `@queryeer/plugin-sdk` that external plugin authors can depend on.
- **Semantic versioning** — adopt semver immediately: patch = backward-compatible type additions, minor = new extension points, major = breaking contract changes.
