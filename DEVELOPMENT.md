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

- Node.js 24.22.1+ (`engines` in `queryeer-desktop/packages/app/package.json`; CI uses the same version)
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

- `plugins/` for per-user external plugins
- `libNative/` for native libraries such as `mssql-jdbc_auth-*.dll`
- `libShared/` for shared runtime jars such as JDBC drivers when supplied outside development dependencies

Dialect plugins such as SQL Server, PostgreSQL, SQLite and MySQL do not package their JDBC drivers. The desktop driver manager downloads verified Maven Central artifacts into `libShared/`, stages replacements while Java is running, and applies them before startup or during a controlled backend-only restart. See `documentation/JDBC_DRIVER_MANAGEMENT.md`.

During repository development, builtin plugin manifests are still loaded from repo `plugins/builtin` as a fallback. This keeps plugin loading production-like while keeping user data out of the repository.

### Backend Commands

Run the full backend verification from the repository root:

```bash
./mvnw -f queryeer-backend/pom.xml clean verify
```

Fast backend preparation without tests/checkstyle:

```bash
./mvnw -f pom.xml -DskipTests=true -DcheckstyleSkip=true install
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

### Adding a New Backend Plugin

When scaffolding a new backend plugin, the following files/registrations are required beyond the Maven module itself:

1. **Backend module `src/dist/plugin.json`** — Production manifest template (Maven-filtered)
2. **Dev manifest** `plugins/builtin/<pluginId>/plugin.json` — Points at `target/classes` + deps
3. **Desktop plugin files** under `src/plugins/<pluginId>/` — `module.ts`, `plugin.tsx`, `ConnectionForm.tsx`
4. **Parent `queryeer-backend/pom.xml`** — Add `<module>` to the modules list
5. **`pom.xml` plugin id + central publish skip** — In the new module's pom, set `<queryeer.plugin.id>` so it ships as a builtin plugin, and `<skipPublishing>true</skipPublishing>` so the `central-publishing-maven-plugin` does not publish it to Maven Central (only foundation libraries intended for external plugin authors should omit the skip and be eligible for Central). The skip is per-module and is checked since 0.9.0 of the central plugin. A module can be both: `backend-lib-queryengine-sql-parser` is a published library and the built-in plugin `queryengine.sql.parser`, so it sets `queryeer.plugin.id` but not `skipPublishing`.

The jlink, dev-mode, and stage-release scripts plus the GitHub Actions publish job all derive their module sets from the parent pom, so no separate list updates are needed there.

### Plugin Discovery

Queryeer always loads builtin plugins first and then per-user external plugins from the managed app-data `plugins/` directory. Builtins are platform components and are never user-disableable.

Use `--safe-mode` to start with external plugin activation disabled. Safe mode still starts builtin plugins so the application can recover from a broken external plugin without losing core functionality.

**Bundled plugins** (since 0.24) are verified plugins that ship with a release, in `resources/plugins/bundled/`: their ZIPs and `bundled-plugins.lock.json` (`{ "schemaVersion": 1, "plugins": [{ "id", "version", "file", "sha256", "url" }] }`). They are not built-ins. On the first start of a new app version, before the backend starts, Queryeer installs each one into the managed `plugins/` directory like a ZIP the user installed, so a newer version from the catalog can replace it later:

- a plugin that isn't installed is installed, and an older one is upgraded; enabled or disabled stays as it was;
- the same or a newer version is left as it is (never a downgrade);
- a plugin the user uninstalled stays uninstalled (`uninstalledIds` in `settings/plugins-lock.json`), until the user installs it by hand again;
- a ZIP that doesn't match its sha256, or holds another plugin or version than the lock says, isn't installed;
- each bundled version of a plugin is applied once (`bundledApplied`), so a plugin the user changes afterwards stays as they left it. A failure, or an install that has to wait because its files are in use, is tried again on the next start, and one plugin failing doesn't stop the others;
- nothing is installed in safe mode, and a developer plugin folder still replaces an installed plugin.

**After an upgrade** Queryeer reports what the new version broke, in one notification on its first start: installed plugins that loaded on the version before and don't now, bundled plugins that don't load, and bundled plugins it couldn't install. Each start records the app version and the installed plugins that loaded in `settings/plugin-load-history.json`, once the backend has reported its plugins. Disabled plugins, plugins changed since the start, developer folders and safe mode are left out, and so is a development run unless `QUERYEER_BUNDLED_PLUGINS_DIR` is set (it shares the app data with the installed app but reports the last release's version). A version before 0.24 recorded nothing, so the first 0.24 start reports every installed plugin that doesn't load. The report closes that start's own toasts about the same plugins; they stay in the notification center.

To try a bundle in a development run, set `QUERYEER_BUNDLED_PLUGINS_DIR` to a folder with the lock and the ZIPs, e.g. ones built with `npm run <plugin>:package` in the plugins repository.

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
- `release.yml`: triggered by `v*` tags. It verifies the backend, uploads the whitelisted public backend artifacts for asynchronous Maven Central publication, stages `@queryeer/api` on npmjs (see [npm Publishing](#npm-publishing)), builds unsigned Windows, macOS, and Linux distributions in a matrix, generates the release changelog, and publishes a real GitHub release with the platform artifacts. GitHub release creation does not wait for Maven Central. Manual `workflow_dispatch` runs exercise the read-only release-history and Central-coordinate checks but skip Maven Central, npmjs, and GitHub release publishing.
- `recover-maven-release.yml`: manually verifies an existing Central deployment and release coordinates. It waits for in-progress deployments, resumes validated deployments, and only re-uploads after Central reports the original deployment as failed and no release coordinates exist.
- `recover-release.yml`: manually creates a missing GitHub release from distribution artifacts produced by an earlier release workflow run after verifying that the run commit matches the release tag.

#### npm Publishing

`@queryeer/api` is published with npm trusted publishing (GitHub OIDC); no npm token is stored in the repository. The trusted publisher on npmjs.com is `kuseman/queryeer-desktop`, workflow `release.yml`, and it is configured as **stage-only**: the `publish-npm` job runs `npm stage publish`, which puts the version in the npm stage queue instead of making it live.

After every release run, a maintainer must approve the staged version (2FA required), either:

- on https://www.npmjs.com/package/@queryeer/api (staged versions), or
- with `npm stage approve <stage-id>`. The stage id is in the `publish-npm` job summary.

Approval waits for npm's malware scan. The GitHub Release and Maven Central do not wait for approval, so approve right after the run; until then plugins cannot install the new `@queryeer/api` version.

The npm CLI version in `publish-npm` is pinned exactly (that job can mint a publish token). Staged publishing needs npm >= 11.15.0; bump the pin deliberately.

**Manual recovery publish.** If the `publish-npm` job fails, publish from the release tag on a workstation:

```bash
git checkout vX.Y.Z
cd queryeer-desktop
npm ci
npm run -w @queryeer/api build
npm login                 # opens the browser to sign in
npm publish -w @queryeer/api --access public
```

Use `npm stage publish` instead of `npm publish` to keep the approval step. 2FA works as follows:

- Passkey/security key: npm prints `Authenticate your account at: https://www.npmjs.com/auth/cli/...`, offers to open the browser on ENTER, and waits until you confirm there.
- Authenticator app: npm prompts `Enter OTP:` in the terminal, or pass `--otp=123456`.

`npm login` sessions are short-lived (about 2 hours), so log in right before publishing. The stage-only setting restricts only the workflow's OIDC publishing, not maintainers publishing with their own account.

Artifacts do not use a trusted publisher certificate for now. macOS builds are ad-hoc signed for application integrity, but downloads may be blocked by Gatekeeper until users explicitly open the app or remove quarantine; public-friendly macOS releases will require Developer ID signing and notarization later.

## Documentation

- [Architecture Decision Records](documentation/)
- [Backend Protocol](documentation/BACKEND_PROTOCOL.md)
