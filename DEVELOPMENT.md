# Queryeer Desktop

[![Desktop CI](https://github.com/kuseman/queryeer-desktop/actions/workflows/queryeer-desktop-ci.yml/badge.svg)](https://github.com/kuseman/queryeer-desktop/actions/workflows/queryeer-desktop-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Monorepo containing the Queryeer Desktop Electron shell and the Java backend runtime.

## Current Status

| Check | Status |
|-------|--------|
| Desktop Build | ![Build](https://img.shields.io/badge/build-passing-brightgreen) |
| Desktop Tests | ![Tests](https://img.shields.io/badge/tests-passing-brightgreen) |
| Backend Verify | ![Backend](https://img.shields.io/badge/backend-verified-brightgreen) |

## Repositories

| Module | Description |
|--------|-------------|
| `queryeer-desktop/` | Electron + React + TypeScript desktop shell |
| `queryeer-backend/` | Java backend reactor |
| `plugins/builtin/` | Development manifests for builtin backend plugins |

## Development

### Prerequisites

- Node.js 20+
- Java 25 compatible JDK on `PATH`
- Maven wrapper from the repository root of `queryeer-backend/` (`mvnw` / `mvnw.cmd`)

### First Setup

```bash
cd queryeer-desktop
npm install
```

### Run The App

From `queryeer-desktop/`:

```bash
npm run dev
```

In development, the Electron main process starts the Java backend on demand. The first backend startup in an Electron session runs a Maven prepare step that compiles the backend runner and builtin backend plugins, generates classpath files, and installs required reactor artifacts into the local Maven repository. After that preparation, the backend is launched directly with `java`, not through `mvn exec:java`.

The development backend uses the same manifest-based plugin discovery model as production:

- Builtin backend plugin manifests live in `plugins/builtin/<pluginId>/plugin.json`.
- Dev manifests point at backend module `target/classes` for fast iteration.
- Dev manifests read Maven-generated `target/queryeer-plugin-deps.txt` files for dependency jars.
- The runner discovers builtin plugins from those manifests instead of hardcoded plugin lists.

This means that a normal `npm run dev` is usually enough. If Java compilation fails during startup, fix the backend error and restart `npm run dev`.

### App Data And Native Libraries

The backend receives Electron's user-data directory as `QUERYEER_APP_DIR` / `queryeer.app.dir`. Runtime data and user-provided native/shared libraries live there, not in the repository root:

- `libNative/` for native libraries such as `mssql-jdbc_auth-*.dll`
- `libShared/` for shared runtime jars such as JDBC drivers when supplied outside development dependencies

During repository development, builtin plugin manifests are still loaded from repo `plugins/builtin` as a fallback. This keeps plugin loading production-like while keeping user data out of the repository.

### Backend Commands

Run the full backend verification from the repository root:

```bash
./mvnw -f queryeer-backend/pom.xml clean verify
```

Fast backend preparation without tests/checkstyle:

```bash
./mvnw -f pom.xml -pl backend-runner,backend-lib-queryengine-jdbc-foundation,backend-lib-queryengine-sql-parser,backend-plugin-jdbc,backend-plugin-payloadbuilder,backend-plugin-dialect-sqlserver -am -DskipTests=true -DcheckstyleSkip=true install
```

On PowerShell, prefer `-DcheckstyleSkip=true` to avoid quoting dotted Maven properties. If using Maven's native checkstyle property, quote it:

```powershell
.\mvnw.cmd -f queryeer-backend/pom.xml '-Dcheckstyle.skip=true' validate
```

### Platform Keybinding Conventions

This application runs on Windows, Linux, and macOS. Keyboard shortcuts must handle the macOS `Cmd` key correctly.

**Rules:**

1. Use `CmdOrCtrl` in all keybinding registrations. Never use `Ctrl` or `Cmd` alone:
   - `key: "CmdOrCtrl+S"` — correct (resolves to `Cmd+S` on macOS, `Ctrl+S` elsewhere)
   - `key: "Ctrl+S"` — wrong (broken on macOS)
   - `key: "Cmd+S"` — wrong (broken on Windows/Linux)

   The `normalizeKeybindingKey()` function in `src/plugins/core.commands/keybinding-resolver.ts` resolves `CmdOrCtrl` per platform. In `DEV` mode, the extension registry warns when a keybinding uses raw `Ctrl` or `Cmd`.

2. When handling keyboard events directly in DOM event handlers, use `isPrimaryModifier()` from `src/shared/platform-utils.ts` instead of checking `ctrlKey` or `metaKey` individually:
   ```typescript
   import { isPrimaryModifier } from "../../shared/platform-utils";
   // Instead of: if (event.ctrlKey || event.metaKey)
   if (isPrimaryModifier(event)) { ... }
   ```

3. Already-existing patterns like `const primaryModifier = e.ctrlKey || e.metaKey` are being migrated to `isPrimaryModifier(e)`.

4. Tests that simulate shortcuts with `ctrlKey: true` should also add a `metaKey: true` variant to validate macOS behaviour.

### Desktop Commands

From `queryeer-desktop/`:

```bash
npm run typecheck
npm run lint
npm run build
npm run test:integration
```

### Adding a New Backend Dialect Plugin

When scaffolding a new backend dialect plugin, the following files/registrations are required beyond the Maven module itself:

1. **Backend module `src/dist/plugin.json`** — Production manifest template (Maven-filtered)
2. **Dev manifest** `plugins/builtin/<pluginId>/plugin.json` — Points at `target/classes` + deps
3. **`queryeer-desktop/scripts/backend-jlink.mjs`** — Add module to `backendModules` array
4. **`queryeer-desktop/scripts/stage-backend-release.mjs`** — Add to `moduleByPluginId` map
5. **`queryeer-desktop/src/main/backend/backend-transport-dev.ts`** — Add to `builtinBackendModules`
6. **Desktop plugin files** under `src/plugins/<pluginId>/` — `module.ts`, `plugin.tsx`, `ConnectionForm.tsx`
7. **Parent `pom.xml`** — Add `<module>` to the modules list

### Plugin Discovery Modes

The backend supports plugin discovery modes for development and troubleshooting:

- `auto`: builtin plugins by default; builtin plus external plugins when `QUERYEER_PLUGINS_PATH` is set
- `builtin`: builtin plugins only
- `mixed`: builtin plus external plugins
- `external`: external plugins only, mainly for isolation/debugging

Most development should use the default `auto` mode.

### Release Flow

Release builds are local-first: the same `queryeer-desktop` scripts used by GitHub Actions can be run on a workstation before creating a real release.

From `queryeer-desktop/`, create a local test release directory build:

```bash
QUERYEER_RELEASE_VERSION=0.1.0-test npm run dist:release -- --dir
```

Build the platform installer/package for the current OS:

```bash
QUERYEER_RELEASE_VERSION=0.1.0-test npm run dist:release
```

The release build performs these steps:

- Generates `dist/generated/CHANGELOG.md` from git history. `queryeer-desktop/CHANGELOG.md` is not committed.
- Builds the Java backend modules and creates a jlink runtime image.
- Builds backend-owned plugin distributions with Maven Assembly under each plugin module's `target/<pluginId>/` directory.
- Stages production backend resources under `queryeer-desktop/dist/release-resources/` from those assembled plugin distributions.
- Runs Electron Builder, bundling the generated changelog into the app root so the About dialog can read `CHANGELOG.md`.

The repository `plugins/builtin` directory is development scaffolding only. Release packaging must not rewrite those manifests.

GitHub release automation is split into two workflows:

- `create-release.yml`: manually dispatched with `major`, `minor`, or `patch`. It computes the next `vX.Y.Z`, bumps desktop and backend to that release version, commits and tags the release, then moves the backend Maven reactor to the next `-SNAPSHOT` version.
- `release.yml`: triggered by `v*` tags. It verifies the backend, builds unsigned Windows, macOS, and Linux distributions in a matrix, generates the release changelog, and publishes a real GitHub release with the platform artifacts.

Artifacts are intentionally unsigned for now. macOS downloads may be blocked by Gatekeeper until users explicitly open the app or remove quarantine; public-friendly macOS releases will require Developer ID signing and notarization later.

## Documentation

- [Architecture Decision Records](queryeer-desktop/documentation/)
- [Backend Protocol](queryeer-desktop/documentation/BACKEND_PROTOCOL.md)
