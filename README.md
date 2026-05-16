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
- Maven wrapper from the repository root (`mvnw` / `mvnw.cmd`)

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
./mvnw -f queryeer-backend/pom.xml -pl backend-runner,backend-lib-queryengine-jdbc-foundation,backend-lib-queryengine-sql-parser,backend-plugin-jdbc,backend-plugin-payloadbuilder,backend-plugin-dialect-sqlserver -am -DskipTests=true -DcheckstyleSkip=true install
```

On PowerShell, prefer `-DcheckstyleSkip=true` to avoid quoting dotted Maven properties. If using Maven's native checkstyle property, quote it:

```powershell
.\mvnw.cmd -f queryeer-backend/pom.xml '-Dcheckstyle.skip=true' validate
```

### Desktop Commands

From `queryeer-desktop/`:

```bash
npm run typecheck
npm run lint
npm run build
npm run test:integration
```

### Plugin Discovery Modes

The backend supports plugin discovery modes for development and troubleshooting:

- `auto`: builtin plugins by default; builtin plus external plugins when `QUERYEER_PLUGINS_PATH` is set
- `builtin`: builtin plugins only
- `mixed`: builtin plus external plugins
- `external`: external plugins only, mainly for isolation/debugging

Most development should use the default `auto` mode.

### Release Packaging Direction

The repository `plugins/builtin` directory is development scaffolding only. A release build should generate a separate staged `plugins/builtin/<pluginId>/` layout under a build output directory, with production manifests pointing at plugin jars and `lib/` dependencies. Release packaging should not rewrite the repo's dev manifests.

## Documentation

- [Architecture Decision Records](queryeer-desktop/documentation/)
- [Backend Protocol](queryeer-desktop/documentation/BACKEND_PROTOCOL.md)
- [Migration Plan](queryeer-desktop/MIGRATION_PLAN.md)
- [Session Handoff](queryeer-desktop/SESSION_HANDOFF.md)
