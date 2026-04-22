# Queryeer Desktop Session Handoff

## Current snapshot

- Desktop shell is booting and running under `queryeer-desktop`.
- Plugin runtime baseline exists with:
  - manifest-based discovery
  - plugin dependency/capability validation
  - activation ordering
  - runtime diagnostics UI
- Backend gateway scaffold exists in desktop main process (`mock-stdio` mode):
  - handshake + ping loop
  - preload API exposes backend status
  - renderer diagnostics panel shows backend state/capabilities/logs
- `stdio-process` mode now includes a backend log panel feed sourced from transport + gateway diagnostics for startup triage.
- Java backend standalone reactor exists under `queryeer-backend` with initial module skeleton.
- Desktop external frontend discovery now supports both folder and `.zip` plugin sources from `QUERYEER_PLUGINS_PATH`.
- Desktop plugin merge now hardens duplicate plugin ids by keeping built-in/internal manifests first and surfacing external duplicate ids as load diagnostics.
- Backend runner discovery now fails fast on duplicate plugin ids across discovered sources.
- Backend runner startup logs now include correlation metadata (`runId`, optional `pluginId`) and redaction for simple secret-like key/value fragments.
- Desktop zip handling is now fully cross-platform and in-process (`jszip`) for runtime extraction and tests (no OS archive shell dependency).
- Core boundary decision documented: core remains host/shell/platform; query/engine/output functionality is external-plugin owned.
- Core shell no longer owns direct query probe actions; dev query probe moved into a dedicated feature plugin.
- Development workflow now includes scripted external plugin staging/watch/run commands for dual-target dev probe package.
- Desktop renderer external module loading now supports dev-server-safe `/@fs` resolution + Vite fs allow-list for repo-level `plugins` directory.
- `dev.query-probe` capability dependency is no longer hard-required at startup (prevents capability validation boot failure in current plugin graph).
- GitHub CI workflow now uses two broad validation jobs: full desktop validation and full backend reactor `clean verify`.
- `core.layout` now has a fixed-zone layout contribution contract draft and registry wiring (`menuBar`, `toolBar`, `statusBar`, `primarySidebar`, `secondarySidebar`, `mainArea`).
- Renderer shell now maps layout contribution snapshots into fixed UI zones (menu/toolbar/status/sidebars/main) with legacy panel compatibility mapping.
- Editor group infrastructure implemented: tab bar rendering, active editor state management, CSS styling for tabs/content.
- File entity / mediator infrastructure is live:
  - `core.files` plugin owns the renderer `FileRegistry` + `FileMediator`
  - mime/editor resolver chains; editor contributions declare `supportedMimeTypes`
  - FileEntity carries dirty flags, engine binding, external-modification flags, viewState bag
  - `file.open`, `file.close`, `file.bind`, `file.change` protocol methods + Java `FileRegistry` / `FileSessionHandler` SPI + `DefaultFileRegistry`
- `core.fileWatcher` plugin runs chokidar in Electron main, dedup+refcounts watchers by (uri, recursive), fans out events, per-URI mute API with active timers.
- `core.workspace` plugin persists session to `<userData>/workspace.json` atomically (files + activeFileUri + layout + backupFileId). Subscribes to fileWatcher per open disk file. Autosave with 3s debounce + 30s max-interval to `<userData>/backups/`. Crash recovery detects surviving backups and exposes `listPendingRestores` / `readBackup` / `discardBackup` API for a future modal UX. Backups now gated by mime capability registry (`backupable` capability) and content validation (non-empty).
- Layout state (visibleZones + sidebar widths) is folded into workspace persistence; `zoneOverrides` delta-state in `ShellApp` was replaced with a direct `Set<LayoutZone>` seeded from restored layout.
- `PROCESS_BOUNDARIES.md` documents the horizontal "Electron main owns disk; Java owns engines; renderer owns UI + in-memory file state" boundary, plus secrets and state-authority tables.
- Shell window chrome is now custom-framed (frameless BrowserWindow) with a VS Code-like top menu strip, draggable titlebar regions, and renderer-driven window controls (minimize / maximize-restore / close).
- Core menu rendering has now been extracted out of `ShellApp` into `core.menu/MenuBar.tsx`, including recursive multi-level submenu rendering and keyboard-driven menu navigation behavior.
- The menu logo is now sourced from a standalone SVG resource (`src/assets/icons/queryeer-logo.svg`) and an icon generation pipeline now emits app/distribution icon assets (`.png`, `.ico`, `.icns`) under `resources/`.

## What changed in this session

### VS Code-like menubar + custom titlebar window controls

- Enabled frameless desktop window chrome (`frame: false`) and completed renderer/main/preload wiring for:
  - `window:minimize`, `window:maximize` (toggle maximize/restore), `window:close`
  - `window:is-maximized` request and `window:state-changed` event for correct maximize/restore icon state
- Reworked `ShellApp` titlebar to mimic VS Code behavior more closely:
  - top-level menu strip with hover/click dropdown behavior
  - right-aligned window controls
  - dedicated drag/no-drag regions to preserve button/menu interactivity and draggable window movement
  - dropdown accelerator rendering beside menu item labels
- Moved menu/titlebar rendering logic from `ShellApp` into `core.menu` module component (`src/plugins/core.menu/MenuBar.tsx`) to keep shell composition lean.
- Added recursive submenu rendering (supports more than one level of nested menu items).
- Added keyboard menu UX:
  - `Alt` toggles menu focus/activation
  - arrow navigation across root menu and nested submenu levels
  - `Enter`/`Space` activate focused menu item
  - `Escape` closes open menus
- Expanded `core.menu` from scaffold to a fuller baseline menu model (`File`, `Edit`, `Selection`, `View`, `Go`, `Run`, `Terminal`, `Help`) with command stubs and representative VS Code-style shortcuts.
- Added nested `View -> Appearance -> Zoom -> (Zoom In/Out/Reset)` subtree to validate deep submenu support.
- Replaced inline TSX logo drawing with an external SVG resource and switched titlebar logo rendering to `<img src>` from that asset.
- Added icon generation script `scripts/generate-icons.mjs` and npm command `npm run assets:icons`:
  - input: `src/assets/icons/queryeer-logo.svg`
  - outputs: `resources/icon.png`, `resources/icon.ico`, `resources/icon.icns`
  - variant set: `resources/icons/icon-{16,24,32,48,64,128,256,512,1024}.png` + copied `.ico`/`.icns`
- Updated electron-builder platform icon paths in `package.json` (`win.icon`, `mac.icon`, `linux.icon`) to use generated resources.
- Added optional `accelerator` metadata on command contracts/registrations and forwarded accelerators to native menu build payload.
- Aligned existing plugin menu contributions to the shared root menus:
  - `core.files` now contributes under `core.menu.file`
  - `core.layout` DevTools command now contributes under `core.menu.view`
- Updated titlebar/menu CSS tokens and component styles for VS Code-like spacing, hover states, dropdown sizing, and control button behavior.
- Updated renderer bootstrap test app-shell mock with new window state APIs.

### Mime capability registry for backupable/file behavior (CORE_WORKSPACE backup fix)

- Added `MimeCapability` type (`backupable`, `executable`, `viewable`, `editable`) to `contracts/files/FilesRegistry.ts`
- Added `ContentCategory` type (`text`, `image`, `binary`) to FilesRegistry contract
- Added `MimeCapabilityRegistry` with:
  - `registerCapabilities` / `hasCapability` for capabilities
  - `registerContentCategory` / `getContentCategory` for content categorization
- Updated `FileRegistry` implementation to support both
- `core.files` plugin now uses `mime-types` library for extension→mime lookup and `isText` for classification:
  - Default capabilities (`backupable`, `editable`, `viewable`) derived from text classification
  - No hardcoded extension map - library handles it
- `core.observability` registers only `viewable` + `binary` category
- `workspace-service.ts` gates backup via capability check
- Future query module can register `executable` for sql mime types
- Editors can now resolve by category: `filesRegistry.capabilities.getContentCategory(mimeType)`

### Previous session

### File entity + mediator model (FILE_ENTITY_MODEL.md)

- `src/contracts/files/FileEntity.ts` + `FileOpenInput` + `FileEntityUpdate`. Fields: id, uri, mimeType, editorId, engineBinding, dirtyVsBackend, dirtyVsDisk, externallyModified, reloadPending, backupUri, hasRecoveredBackup, viewState, version counters, openedAt.
- `viewState: Record<string, unknown>` — editor-namespaced bag. Replaced earlier text-specific `cursor`/`scroll` fields so non-text editors (image viewers, result grids, diagrams) fit natively.
- `src/contracts/files/FilesRegistry.ts` + `core/plugin-runtime/FileRegistry.ts` — open/close/list/update/subscribe + resolver registration + `classifyUri`/`resolveEditor`.
- `src/contracts/files/Resolvers.ts` — MimeResolver/EditorResolver/MimeHint + baseline mime resolver in `core.files` (extension map for common types). `LayoutEditorContribution` gained `supportedMimeTypes?: string[]`.
- `src/contracts/files/FileMediator.ts` + `core/plugin-runtime/FileMediator.ts` — openFile (classifies, lazy backend-bind), closeFile (dirty check), saveFile (disk-version stamp; stub for real disk write), notifyChanged (debounced backend `file.change`), bindEngine, executeFile, reloadFile, acceptExternalChange, discardExternalChange. `onFileChanged` callback option for workspace autosave hook.
- TS protocol additions (`src/contracts/backend/`): `file.open` / `file.close` / `file.bind` requests + `file.change` notification + optional `fileId` on `query.execute`.
- Preload + `BackendGateway` IPC handlers for the new protocol methods; `MockBackendTransport` responds success.
- Java contracts (`queryeer-backend/backend-contract/.../file/`): `FileOpenParams/Result`, `FileCloseParams/Result`, `FileBindParams/Result`, `FileChangeNotification`, `FileEngineBindingParams`. `QueryExecuteParams` extended with `fileId`.
- Java SPI (`backend-api`): `FileSession`, `FileSessionHandler`, `FileSessionHandlerRegistry`, `FileRegistry`. `BackendPluginContext.fileSessions()` added.
- `backend-core/DefaultFileRegistry` implements both interfaces; wired through `BackendPlatformServices` + `DefaultBackendPluginContext`.
- Transport: `FileOpenRequestHandler`, `FileCloseRequestHandler`, `FileBindRequestHandler`, `FileChangeNotificationHandler`. New `NotificationHandler` + `NotificationDispatcher`; `StdioTransportServer` routes notifications. `BackendCapabilities` lists the new methods.
- `backend-transport-stdio` pom now depends on `backend-api` (not `backend-core`) — preserves the architectural boundary.
- Protocol fixtures under `protocol-fixtures/backend/`: `request-file-open.json`/`response-file-open.json`, `request-file-close.json`/`response-file-close.json`, `request-file-bind.json`/`response-file-bind.json`, `notification-file-change.json`. Java `ProtocolFixtureCompatibilityTest` + TS `scripts/backend-protocol-fixtures-check.mjs` cover them.

### core.fileWatcher plugin (CORE_FILE_WATCHER_MODEL.md)

- Service runs chokidar (v4) in Electron main with `awaitWriteFinish`, `followSymlinks: false`, `ignoreInitial: true`, non-recursive depth cap.
- Subscription-based contract via `PluginContext.fileWatcher`; preload bridges `watchFile`/`unwatchFile`/`muteFileWatcherPath` + single event channel `file-watcher:event`.
- Dedup by `(uri, recursive)`: one chokidar per unique key, fan-out to subscribers; ref-counted close on last unwatch.
- `mutePath(uri, durationMs)` with active per-URI setTimeout cleanup; `unmutePath` + `dispose`.
- Event normalization (#5) deferred until workspace has real-world Windows atomic-save feedback.
- WebContents lookup + watcher factory are injectable for unit testing.

### core.workspace plugin (CORE_WORKSPACE_MODEL.md)

- Persistence: `<userData>/workspace.json` with `schemaVersion: 1`, atomic write (temp + rename + fsync), 500ms debounce + flush on quit. Reader tolerates ENOENT + schema-version mismatch (fresh session) and `workspace.json.broken-<timestamp>` rename for corrupt files (migration path placeholder).
- Hydrate: re-opens persisted files via mediator, seeds `activeFileId` and layout state, starts filesRegistry subscription that pushes snapshots on changes.
- ShellApp auto-open suppressed when workspace restored files. Cursor-free seeded initial `openFileIds`/`activeFileId`. `zoneOverrides` delta-state replaced with direct `Set<LayoutZone>`.
- Layout state folded in (visibleZones + sidebar widths); `PersistedLayoutSnapshot` in `WorkspaceSnapshot.ts`.
- File watcher integration: per-open-disk-file subscriptions; on event: active+clean → silent `mediator.reloadFile`; else `externallyModified: true` + `reloadPending: !active && !dirty`. `setActiveFileId` auto-reloads reloadPending-clean files.
- Autosave: dual trigger (3s debounced edit + 30s max-interval), `BackupStore` under `<userData>/backups/` with `<fileId>.<timestampMs>.bak` naming + retention cap of 5. `fireBackup` skips clean files, updates `FileEntity.backupUri`. `syncBackups` purges on close + on dirty→clean transitions.
- Crash recovery: `PersistedFileEntry.backupFileId` survives restart. On hydrate, `readLatestBackup` detects surviving backups and sets `hasRecoveredBackup` + `backupUri`. Service exposes `listPendingRestores()`, `readBackup(fileId)`, `discardBackup(fileId)` for future modal UI. `syncBackups` skips auto-purge for recovered entities.
- Bootstrap late-binds the `onFileChanged` callback to the workspace (service construction follows host construction).

### Process boundary documentation (PROCESS_BOUNDARIES.md)

- New doc. Horizontal Electron-main / renderer / Java-backend boundary.
- Disk ownership rule: Electron main is sole disk authority; backend sees strings.
- Secrets boundary: plaintext only inside `credential.store`; all subsequent calls use `connectionId` handle.
- State-authority table: who owns what (files/layout/watchers/backups/engine sessions/executions/connections).
- Open questions flagged: engine-initiated file reads, large/binary content.

### Validation

- `npm run typecheck` / `lint` / `test` (142 passed, 4 skipped across 18 test files) / `build` all green.
- `node scripts/backend-protocol-fixtures-check.mjs` green.
- `./mvnw -f queryeer-backend/pom.xml clean verify` — 9/9 modules SUCCESS (earlier in the session when file.* protocol landed).

---

### Previous session(s)

- Hardened plugin discovery/wiring rules end-to-end:
  - backend runner now rejects duplicate plugin ids during manifest-first discovery (`PluginDiscoveryService`)
  - desktop discovery merge now ignores conflicting external plugin ids and records a load error for diagnostics (`src/plugins/discovery.ts`)
- Added zip-based external frontend plugin loading in desktop main process:
  - `discoverExternalFrontendPlugins()` now scans folder + zip sources
  - zip plugins are extracted to OS temp storage and loaded via validated `plugin.json` + `frontend.entryModule`
  - path safety guard added to prevent module path escape outside extracted/folder plugin root
  - added tests in `src/main/plugins/frontend-plugin-discovery.test.ts` for folder, zip, and duplicate-id behavior
- Added backend observability/test coverage improvements:
  - `RequestDispatcher` unknown-method errors now include structured `details` (`requestId`, `method`)
  - new `RequestDispatcherTest` covers dispatch routing + unknown-method mapping
  - backend-runner logs now include correlated prefixes and simple secret redaction
  - added runner test coverage for duplicate plugin id detection across plugin sources
- Removed desktop OS-specific archive dependencies:
  - runtime zip plugin extraction now uses in-process `jszip` extraction instead of `Expand-Archive` / `unzip`
  - zip fixture generation in plugin discovery tests now uses `jszip` instead of shell commands
  - this eliminates win32-specific test/runtime behavior for frontend plugin package handling
- Desktop validation now runs successfully in this environment:
  - `npm run typecheck` pass
  - `npm run lint` pass
  - `npm run test` pass
  - `npm run build` pass
- Added boundary guidance artifact:
  - `queryeer-desktop/documentation/CORE_BOUNDARY.md`
  - defines internal core responsibilities, recommended core plugin set, external-plugin-only domains, and enforcement checklist
- Implemented boundary decision in code by extracting query probe behavior from shell UI:
  - removed bundled/internal `dev.query-probe` plugin from desktop manifests/module loaders
  - added fully external dual-target plugin package scaffold under `plugins/dev-query-probe`
  - frontend probe now lives in external module (`plugins/dev-query-probe/frontend/module.mjs`)
  - backend companion plugin now exists as standalone reactor module (`backend-plugin-devprobe`)
  - `ShellApp` backend diagnostics section now remains generic and no longer directly triggers query execute/cancel
- Added streamlined development workflow scripts for external dev probe package:
  - `npm run dev:plugin:stage` builds/stages backend devprobe jar(s) into `plugins/dev-query-probe/lib`
  - `npm run dev:plugin:watch` watches backend module + plugin package files and re-stages automatically
  - `npm run dev:with-plugins` launches desktop with `QUERYEER_PLUGINS_PATH=<repo>/plugins`
  - documented in `plugins/dev-query-probe/README.md`
- Fixed external plugin dev loading issues for desktop renderer:
  - external module URL mapping now uses Vite `/@fs` path in dev-server mode
  - `electron.vite.config.ts` now allows filesystem access to repo-level `plugins` folder
- Updated backend runner manifest model to accept `description` from plugin manifests, aligning with schema and external package manifests.
- Updated `.github/workflows/queryeer-desktop-ci.yml` job structure:
  - desktop job remains full desktop checks (`test`, protocol fixtures, `typecheck`, `lint`, `build`)
  - backend job now runs full backend reactor verification (`./mvnw -f queryeer-backend/pom.xml clean verify`)
- Added first fixed-zone layout contract and runtime wiring:
  - new layout extension contract types + registry API in desktop runtime
  - `PluginContext` now exposes `layout` registry alongside commands/panels/filesystems
  - `core.layout` now contributes shell defaults, menu items, status item, and welcome contribution through layout registry
  - legacy panel registration remains temporarily for compatibility during migration
  - draft architecture note added: `queryeer-desktop/documentation/LAYOUT_EXTENSION_MODEL.md`
- Implemented first fixed-zone renderer mapping in `ShellApp`:
  - menu bar + toolbar now render from `extensions.layout` contributions
  - primary/secondary sidebars render `layout.views` contributions
  - main area renders welcome contributions and existing diagnostics/runtime cards
  - status bar renders contributed status items and backend state indicator
  - legacy `panels` contributions are still rendered by placement (`left/right/center/bottom`) for migration compatibility
- Migrated built-in layout contribution off legacy panel API:
  - `core.layout` no longer registers legacy `panels` welcome contribution
  - `core.layout` now contributes fixed sidebar views via `layout.registerView` for primary/secondary slots
- Deprecated legacy panel extension point in code:
  - removed `PanelExtension` contract and `PanelRegistry` from `PluginContext`
  - removed panel registry/snapshot support from runtime `ExtensionRegistry`
  - `ShellApp` no longer renders legacy placement-based panel mappings
  - plugin UI contributions are now layout-only (`registerView` / `registerEditor` / `registerWelcome`)
- Implemented editor group infrastructure in main area:
  - Added `order` field to `LayoutEditorContribution` contract
  - ShellApp now maintains `openEditorIds` and `activeEditorId` state
  - Tab bar renders when editors are open with close buttons per tab
  - Active editor content renders in main area, fallback to welcome/blank state
  - Added CSS styling for editor tabs and content pane
  - Added `core.layout.openEditor` and `core.layout.closeEditor` command stubs in core.layout plugin
  - First contributed editor auto-opens when shell loads

- Renamed desktop project folder from `electron-shell` to `queryeer-desktop` and updated naming references.
- Added Java backend standalone Maven reactor scaffold under `queryeer-backend`:
  - `backend-api`
  - `backend-contract`
  - `backend-core`
  - `backend-transport-stdio`
  - `backend-runner`
  - `backend-plugin-payloadbuilder`
  - `backend-plugin-jdbc`
- Added root `AGENTS.md` with mandatory session update instructions.
- Added backend quality gates in `queryeer-backend`:
  - Spotless Maven plugin configured and applied
  - Checkstyle Maven plugin configured with `queryeer-backend/checkstyle.xml`
  - `queryeer-backend` verify now enforces formatting + style at `validate` phase
- Implemented first end-to-end backend plugin communication flow in desktop mock path:
  - gateway now supports IPC methods `backend:execute-query` and `backend:cancel-query`
  - mock backend now handles `query.execute` / `query.cancel`
  - progress/chunk/completed/failed notifications update execution state in gateway
  - renderer diagnostics can run/cancel mock queries and display recent execution states
- Implemented Java stdio transport scaffold for first protocol set:
  - NDJSON read/write loop in `backend-transport-stdio`
  - method handlers for `backend.handshake`, `health.ping`, `query.execute`, `query.cancel`
  - mocked query notifications (`progress`, `resultChunk`, `completed`, `failed`)
  - backend runner now launches transport on `System.in` / `System.out`
- Refactored Java transport into manual DI/wiring composition:
  - split transport responsibilities into `EnvelopeCodec`, `ResponseWriter`, `NotificationPublisher`,
    `RequestDispatcher`, `MockQueryExecutionService`, `StdioTransportServer`
  - moved mock query execution behavior out of transport server into dedicated service
  - runner now acts as composition root wiring transport components
  - protocol DTO packages reorganized by concern (`handshake`, `health`, `query`)
- Added desktop backend transport abstraction with pluggable runtime modes:
  - `MockBackendTransport` (existing in-memory behavior)
  - `StdioProcessBackendTransport` (spawns `backend-runner` via Maven exec)
  - gateway selects transport via env var `QUERYEER_BACKEND_STDIO=1`
- Added backend observability slice in desktop gateway/renderer:
  - `BackendGatewayStatus` now carries `backendLogs` ring buffer entries
  - transport now emits structured diagnostics (`debug|info|warn|error` + source)
  - gateway records lifecycle/request/timeout events to an in-memory capped log buffer
  - renderer diagnostics view now renders a backend log panel (timestamp/level/source/message)
- Refactored backend gateway internals into focused main-process modules to reduce complexity:
  - `BackendStatusStore`
  - `BackendExecutionStore`
  - `BackendPendingRequestMap`
  - `BackendLogBuffer`
  - `BackendGateway` now orchestrates these components rather than owning all state directly
- Fixed Java/TS wire compatibility issue in backend envelopes:
  - Java `EnvelopeType` now serializes/deserializes lowercase wire values (`request|response|notification`)
  - this unblocks desktop handshake request decoding in Java stdio transport
  - added `jackson-annotations` dependency to `backend-contract` for enum JSON mapping annotations
- Added first cross-runtime protocol fixture harness (handshake/ping):
  - shared fixtures introduced under `protocol-fixtures/backend/`
  - desktop script `npm run test:protocol-fixtures` validates fixture envelope shape + ids + methods
  - backend `backend-contract` JUnit test validates fixture decode + DTO mapping compatibility
  - this creates an early guardrail against TS/Java protocol drift
- Centralized backend test/dependency version management in root reactor POM:
  - moved Jackson/JUnit/Surefire version ownership to `queryeer-backend/pom.xml`
  - `backend-contract`, `backend-transport-stdio`, and `backend-runner` now inherit Jackson versioning from root `dependencyManagement`
- Added proper unit-test harness to desktop project:
  - introduced Vitest config (`vitest.config.ts`) with separate `main` (node) and `renderer` (jsdom) projects
  - added scripts: `npm run test`, `npm run test:watch`, `npm run test:coverage`
  - added initial unit tests for backend main-process helper modules:
    - `BackendLogBuffer`
    - `BackendStatusStore`
    - `BackendExecutionStore`
    - `BackendPendingRequestMap`
  - fixture check script remains available as `npm run test:protocol-fixtures`
- Added first gateway orchestration unit tests in desktop:
  - `backend-gateway.ts` now supports injectable transport factory for testability
  - new tests validate startup handshake/ping transition to `healthy`
  - new tests validate `query.execute` request dispatch and execution status tracking
- Expanded shared protocol fixture coverage and cross-runtime checks:
  - added fixtures for `query.execute` and `query.cancel` request/response pairs
  - added fixtures for `query.progress`, `query.resultChunk`, `query.completed`, `query.failed` notifications
  - extended desktop fixture script to validate execute/cancel and notification fixtures
  - extended backend `ProtocolFixtureCompatibilityTest` to decode/validate execute/cancel and all query notifications
- Added gateway negative-path tests in desktop:
  - handshake timeout (`backend.handshake` no response)
  - `query.execute` send failure path
  - `query.execute` timeout path
  - unknown response id warning log path
  - ping loop failure path (error response -> unavailable)
- Added CI workflow for migration guardrails:
  - `.github/workflows/queryeer-migration-ci.yml`
  - runs desktop unit tests + protocol fixture script + typecheck + lint + build
  - runs backend `backend-contract` fixture compatibility tests
- Added first security hardening for diagnostics logging:
  - introduced `backend-log-redaction.ts` and integrated it into gateway/transport log paths
  - sensitive tokens/credentials are now masked before writing to backend log buffer/status panel
  - added unit tests for redaction behavior (`backend-log-redaction.test.ts`)
  - protocol document updated with explicit sensitive-field redaction and no-raw-secret guidance
- Added first credential-handle contract scaffolding across TS + Java:
  - new request methods: `connection.upsert`, `credential.store`
  - TS backend contracts now define params/results for connection metadata upsert and credential store
  - Java backend-contract now includes corresponding DTOs/enums under `connection` and `credential` packages
  - Java stdio dispatcher now mocks handling for `connection.upsert` and `credential.store`
  - handshake capabilities now include new methods
  - shared protocol fixtures and dual-side fixture checks now include connection/credential method pairs
  - protocol documentation updated with explicit method specs and secret-handling constraints
- Refactored capability/request dispatch ownership to reduce central orchestration coupling:
  - desktop now has centralized capability constants in `src/contracts/backend/Capabilities.ts`
  - gateway handshake capability request list now references shared constants (not inline literal list)
  - Java stdio request handling moved from one large switch implementation to per-method handler classes:
    - `HandshakeRequestHandler`
    - `HealthPingRequestHandler`
    - `QueryExecuteRequestHandler`
    - `QueryCancelRequestHandler`
    - `ConnectionUpsertRequestHandler`
    - `CredentialStoreRequestHandler`
  - `RequestDispatcher` now routes using handler registry (`RequestHandler` interface + method map)
  - backend handshake supported capabilities centralized in `BackendCapabilities`
- Added backend platform skeleton v1 in Java backend core:
  - introduced default platform services and plugin context composition in `backend-core`
    - `DefaultLoggerService`
    - `InMemoryConfigService`
    - `NoopSecretService`
    - `InMemoryEventBus`
    - `InlineSchedulerService`
    - `InMemoryQueryEngineRegistry`
    - `InMemoryMetadataRegistry`
    - `BackendPlatformServices` + `DefaultBackendPluginContext`
  - `PluginRuntime` now supports `activateAll` / `deactivateAll` lifecycle orchestration
  - `backend-runner` now wires platform services and activates/deactivates plugins via runtime
  - added architecture-focused tests for runtime activation/deactivation behavior in
    `backend-core/src/test/java/com/queryeer/backend/core/PluginRuntimeArchitectureTest.java`
- Expanded backend-core plugin governance layer with validation + status model:
  - added dependency validation and topological activation planning (`PluginValidation.planActivation`)
  - added required-capability validation against provided-capability set
  - added cycle detection for dependency graph
  - added runtime status model (`PluginRuntimeState`, `PluginRuntimeStatus`) exposed from `PluginRuntime.statuses()`
  - runtime now marks plugins as `LOADED`, `SKIPPED`, `ACTIVATED`, `FAILED`, `DEACTIVATED` with reasons
  - activation failures are captured as `FAILED` and runtime continues activating remaining planned plugins
  - added architecture tests for missing dependency, missing capability, cycle detection, failure status propagation,
    and dependency-ordered activation
- Added backend runtime diagnostics endpoint and startup summary logging:
  - new protocol method `backend.runtimeStatus` added to TS/Java contracts
  - runner now logs startup summary counts (`activated/skipped/failed`) and per-plugin runtime state lines
  - new stdio request handler `RuntimeStatusRequestHandler` exposes runtime status snapshot
  - runtime status payload includes `startedAt`, `pluginStatuses`, `activatedPluginIds`, and optional `providedCapabilities`
  - handshake capability declarations now include `backend.runtimeStatus`
  - desktop gateway now fetches runtime status after startup and on ping refresh when capability is advertised
  - renderer diagnostics panel now shows runtime plugin status table
  - shared fixtures + dual-side fixture checks now include `backend.runtimeStatus`
- Implemented plugin discovery step 1+2 (manifest-first + folder/zip source discovery):
  - backend-runner now supports manifest-first discovery from plugin sources (`plugin.json`)
  - folder and `.zip` sources under plugin path are discovered via filesystem scan
  - each discovered plugin is loaded with an isolated `URLClassLoader`
  - manifest metadata now drives runtime descriptor contract (`id`, `version`, deps, capabilities)
  - entrypoint class is instantiated reflectively from manifest `entrypointClass`
  - added discovery component split in runner package:
    - `PluginSourceExplorer`
    - `PluginManifestLoader`
    - `PluginClasspathFactory`
    - `PluginFactory`
    - `PluginDiscoveryService`
    - `PluginManifestBackedPlugin`
  - plugin path can be provided via `-Dqueryeer.plugins.path=...` or `QUERYEER_PLUGINS_PATH`
  - fallback to built-in plugin registration remains when no external plugin path is provided
  - startup diagnostics now include discovered plugin source (`builtin` or path) and isolation flag
  - added runner tests for manifest discovery behavior (`PluginManifestDiscoveryTest`)
- Added plugin manifest v1 schema + target resolver contracts for next packaging evolution:
  - new shared schema file: `plugin-schema/plugin.json.schema.v1.json`
  - runner manifest now supports optional `backend` and `frontend` sections under one plugin identity
  - added manifest validation enforcing:
    - schemaVersion=1
    - required base fields (`id`, `name`, `version`)
    - at least one target (`backend` or `frontend`)
    - required target entrypoints (`backend.entrypointClass`, `frontend.entryModule`)
  - introduced target-specific resolver interfaces in runner:
    - `BackendPluginResolver`
    - `FrontendPluginResolver`
  - added manifest-based resolver implementations and `PluginDiscoveryService.DiscoveryResult`
    separating backend vs frontend discoveries
  - current runtime wires backend-discovered plugins and logs frontend discoveries for future desktop wiring
- Wired desktop frontend plugin discovery path for external plugin packages:
  - main process now exposes `plugins:get-frontend-targets` IPC and discovers external frontend targets from plugin folders
    under `QUERYEER_PLUGINS_PATH` (manifest-first `plugin.json`, schemaVersion=1)
  - preload now exposes `getExternalFrontendPlugins()`
  - renderer bootstrap now merges external frontend manifests into plugin discovery input
  - plugin discovery now supports dynamic external module loading via manifest module path (`frontend.entryModule`)
    while preserving internal static module loaders
  - external manifest metadata is normalized into existing `PluginManifestFile` shape for runtime diagnostics/lifecycle

## Next 3 tasks

1. Add mnemonic-letter navigation parity (eg Alt+F/Alt+E) plus typed first-character matching inside open menus.
2. Monaco editor plugin (or a simple text-editor plugin) — first real consumer of FileEntity + viewState, enables actual `reloadFile` disk-read wiring + real notifyChanged text flow.
3. Modal/notification UI plugin — drives the active+dirty external-change prompt (Reload/Keep/Diff) and the crash-recovery prompt (Restore/Discard). WorkspaceService already exposes the data via `listPendingRestores` / `readBackup`.

## Known gaps / temporary scaffolds

### File entity / workspace / file watcher
- `FileMediator.reloadFile` currently just resets flags — real disk re-read waits for a `readFile` IPC + an editor that can apply content to its buffer.
- `FileMediator.saveFile` currently just stamps `diskVersion = version` and clears `dirtyVsDisk` — no disk write yet. Save flow ties into `PROCESS_BOUNDARIES.md` disk-ownership rule; implementation follows when an editor produces text to write.
- `notifyChanged(fileId, text)` is called by editors passing text explicitly. No editor model exists yet; the shape is ready.
- No UI surfaces the external-change prompt (active+dirty) or crash-recovery prompt. Workspace service exposes the data via `listPendingRestores` / `readBackup` / `discardBackup` — a future modal plugin consumes them.
- `core.fileWatcher` increment 5 (atomic-save delete+add event normalization + inotify-limit warning) is deferred. Noted in `CORE_FILE_WATCHER_MODEL.md`.
- Backups from previous sessions can orphan if the user doesn't discard — `BackupStore` retention caps within-session but doesn't purge stale per-fileId across sessions. Acceptable until modal UX lands.
- `hasRecoveredBackup` stays true until explicit `discardBackup` or a future `applyBackup`; the "auto-purge on clean" branch skips recovered entities to avoid silently revoking the user's choice.

### Older gaps (still relevant)
- Current `core.menu` command handlers are mostly placeholder stubs for parity scaffolding; real command routing (command palette, quick open, run/terminal actions, zoom behavior) is pending downstream feature plugins.
- Icon generation currently relies on dev dependencies (`sharp`, `to-ico`, `png2icons`); if CI/release should regenerate icons, `npm run assets:icons` must be added to the release workflow.
- Desktop defaults to mock transport unless `QUERYEER_BACKEND_STDIO=1` is set.
- Java stdio transport protocol handling is real, but execution internals and credential persistence remain mocked/stubbed.
- `FileSessionHandler` SPI exists in `backend-api`, but no engine plugin implements it yet — parse-tree reuse via `query.execute.fileId` is not live.
- External plugin discovery currently focuses on manifest-first loading and isolated classloaders; signature validation and hot-reload are intentionally deferred.
- Frontend target discovery is now represented in runner contracts but Java-side frontend targets are still not consumed directly by desktop runtime.
- Shared TS/Java fixtures and CI checks cover handshake/ping/query/connection/credential/file.* contract shapes.
- Java-side diagnostics redaction and request-correlation logging are still pending (desktop-side redaction is implemented).
- Renderer-side unit tests now cover bootstrap, external plugin diagnostics, FileRegistry, FileMediator, FileWatcher (main + renderer), WorkspaceStore, WorkspaceService (incl. autosave + crash recovery), BackupStore — but broader UI interaction coverage is still minimal.
- Migration CI coexists with legacy workflows; overlap consolidation is still pending.
- `PluginDescriptor` metadata still overlaps with manifest metadata in backend API/runtime path; ownership consolidation is documented but not yet fully implemented.

## Validation commands

- Desktop (from `queryeer-desktop`):
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
- Backend (from repo root):
  - `./mvnw -f queryeer-backend/pom.xml -DskipTests=true clean verify`
  - `./mvnw -f queryeer-backend/pom.xml spotless:apply` (when formatting is needed)
