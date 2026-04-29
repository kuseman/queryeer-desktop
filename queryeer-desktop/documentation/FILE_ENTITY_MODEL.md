# File Entity & Mediator Model (Draft v1)

This document defines the `FileEntity` concept and the mediator pattern that coordinates file state between the renderer and the Java backend.

Status: implemented (4/5 increments). Increment #5 (engine binding + execute reuse of parse trees, payloadbuilder first) is deferred — see §7.

## 1. Goals

- Treat every editable artifact (query file, script, scratch buffer) as a uniform `FileEntity` with a resolved mime type, editor, and optional engine binding.
- Keep engine/editor resolution contribution-based — no hardcoded engine or editor ids in core (per `CORE_BOUNDARY.md`).
- Split file state ownership cleanly between a frontend registry (UI/dirty state) and a backend registry (connections, parse trees, engine sessions).
- Route all cross-cutting file operations through a single `FileMediator` so no component reaches into layout, backend, or registries directly.

## 2. Concept model

Every file flows through four resolution stages:

| Stage | Resolves to | Who owns |
|---|---|---|
| identity | `fileId` + `uri` (scheme://path) | Core |
| classification | `mimeType` (from extension, sniff, or declared) | Core, via mime resolver chain |
| editor | `editorId` (chosen editor contribution) | Core, via editor resolver |
| engine binding | `engineId` + optional `connectionId` (query files only) | Core, via engine resolver |

Core owns the entity and the resolution pipeline. Plugins contribute resolvers (mime, editor, engine).

## 3. Frontend file-registry (`core.files`)

New built-in plugin `core.files` owning a `FileRegistry` service, exposed via `PluginContext.files`.

### 3.1 Entity shape

```ts
type FileEntity = {
  fileId: string;             // stable uuid
  uri: string;                // "file:///..." or "untitled:new-1"
  mimeType: string;
  editorId?: string;          // chosen editor contribution (null until opened)
  engineBinding?: {
    engineId: string;
    connectionId?: string;
  };
  dirtyVsBackend: boolean;    // frontend version > last acknowledged backend version
  dirtyVsDisk: boolean;       // frontend version > last saved disk version
  externallyModified?: boolean;
  reloadPending?: boolean;
  backupUri?: string;
  runtimeViewState?: unknown;  // non-serializable; not persisted (e.g. Monaco view state)
  persistentViewState?: Record<string, unknown>; // serializable; persisted
  version: number;            // bumped on every local change
  backendVersion?: number;    // last version acknowledged by backend
  diskVersion?: number;       // last version persisted to disk
  openedAt: string;
};
```

**`runtimeViewState`** holds non-serializable editor state that exists only during the editor session (e.g. Monaco's scroll position, cursor state). It is NOT persisted and is released when the editor is disposed.

**`persistentViewState`** holds a namespaced bag of editor states (`{ "monaco.editor": {...}, "visual.editor": {...} }`) that survive across sessions. The workspace persists this bag verbatim. Each editor contribution is keyed by its plugin id or a stable string.

**`runtimeViewState`** and **`persistentViewState`** are separate to allow fine-grained control over what gets persisted. Each editor contribution owns the shape of its `persistentViewState` — core never interprets the contents. Workspace persistence round-trips the bag verbatim.

### 3.2 Responsibilities

- Open/close lifecycle and lookup by `fileId` or `uri`.
- Dirty tracking for both axes (`dirtyVsBackend`, `dirtyVsDisk`) as two independent flags.
- Version counter, bumped when the editor calls `notifyChanged(fileId)`.
- Subscription API so views (tab titles, breadcrumbs, status bar) react to entity changes.

### 3.3 Non-responsibilities

- Does NOT hold content buffers. The editor view owns the text model. The registry only tracks flags and version numbers.
- Does NOT call the backend directly. All backend sync goes through the mediator.

## 3.4 Editor View State

Each editor is responsible for storing and restoring its own view state. The `FileEntity` tracks two view state fields:

- **`runtimeViewState`**: Non-serializable Monaco view state (scroll position, selection, etc.). Not persisted.
- **`persistentViewState`**: Serializable editor state bag, keyed by editor contribution. Persisted to disk/workspace.

Editors retrieve and store view state via `FilesRegistry`:

```ts
// Get persisted state when opening a file
const state = filesRegistry.getEditorState(fileId, "monaco.editor");

// Apply state to editor
editor.setViewState(state);

// Save state when switching files or closing
filesRegistry.setEditorState(fileId, "monaco.editor", editor.getViewState());
```

Each editor contribution owns the shape of its state within `persistentViewState`. Core never interprets the contents. The registry stores state in a namespaced bag (`persistentViewState["monaco.editor"] = {...}`) to allow multiple editors per file.

## 4. Backend file-registry (`backend-api` + `backend-core`)

New SPI in `backend-api` and default implementation in `backend-core`.

### 4.1 SPI

```java
public interface FileRegistry {
    FileSession open(FileOpenRequest request);
    void change(String fileId, long version, String text);
    void close(String fileId);
    Optional<FileSession> get(String fileId);
}

public interface FileSessionHandler {
    String engineId();
    void onOpen(FileSession session, String text);
    void onChange(FileSession session, String text);
    void onClose(FileSession session);
}
```

### 4.2 Session shape

```java
record FileSession(
    String fileId,
    URI uri,
    String mimeType,
    String engineId,          // optional
    String connectionId,      // optional
    Object parseTree,         // engine-specific, opaque to core
    EngineContext engineCtx,  // open session, scope, etc.
    long backendVersion
) {}
```

### 4.3 Rules

- `FileRegistry` is the authoritative holder of per-file backend state.
- Engine plugins register a `FileSessionHandler` keyed by `engineId`; core routes open/change/close to the matching handler.
- Handlers own engine-specific resources (JDBC connections, PB scopes, parse caches) and must release them in `onClose`.
- Cancellation of an in-flight query MUST NOT destroy the file session; session lifetime is independent of query lifetime.

## 5. Mediator (renderer, in `core.files`)

A `FileMediator` is the single entry point for cross-cutting file actions. Views, commands, and plugins call the mediator; the mediator fans out to registry, resolvers, backend, and layout.

```ts
class FileMediator {
  openFile(uri: string, hint?: { mimeType?; editorId?; engineId? }): Promise<FileEntity>;
  closeFile(fileId: string, opts?: { discardDirty?: boolean }): Promise<void>;
  saveFile(fileId: string): Promise<void>;
  notifyChanged(fileId: string): void;
  bindEngine(fileId: string, engineId: string, connectionId?: string): Promise<void>;
  executeFile(fileId: string): Promise<QueryExecutionId>;
}
```

### 5.1 `openFile` pipeline

1. Classify mime via mime resolver chain.
2. Resolve editor contribution via editor resolver.
3. Create `FileEntity` in the frontend registry.
4. If an engine resolver matches, auto-bind (but do not open a backend session yet — see §7.1).
5. Emit `file.open` to backend only if already bound (lazy rule).
6. Route entity to the layout editor tab.

### 5.2 Change debouncing

Debouncing of `notifyChanged` → `file.change` lives in the mediator with a configurable interval. Neither the editor nor the backend is responsible for debouncing.

### 5.3 `executeFile`

Pulls current text from the editor model, ensures the backend session is up to date (flush pending debounced change), then calls `queryengine.execute` with the `fileId` so the backend reuses the cached parse tree.

## 6. Protocol additions

Additive, backward-compatible (protocol minor bump). Java DTOs go under `queryeer-backend/backend-contract/src/main/java/com/queryeer/backend/contract/file/`; TS types go under `queryeer-desktop/src/contracts/backend/`.

### 6.1 `file.open` (request)

```json
{
  "fileId": "f-001",
  "uri": "file:///path/to/query.pb",
  "mimeType": "text/x-payloadbuilder",
  "engineId": "payloadbuilder",
  "connectionId": "conn-001",
  "initialText": "select 1"
}
```

### 6.2 `file.change` (notification, renderer → backend)

```json
{
  "fileId": "f-001",
  "version": 7,
  "text": "select 2"
}
```

### 6.3 `file.close` (request)

```json
{ "fileId": "f-001" }
```

### 6.4 `file.bind` (request)

```json
{ "fileId": "f-001", "engineId": "payloadbuilder", "connectionId": "conn-001" }
```

### 6.5 `queryengine.execute` extension

Add optional `fileId` to `queryengine.execute` params. When `fileId` is present and the backend has a matching session, backend SHOULD reuse the cached parse tree instead of re-parsing `text`. `text` remains accepted for stateless callers (probes, CLI).

## 7. Extension contract expansions

### 7.1 Lazy backend sessions

Untitled files do NOT get backend sessions immediately. A backend `file.open` is sent only when the file has been bound to an engine (either by `files.registerEngineResolver` matching at open time, or by an explicit `FileMediator.bindEngine` call). This keeps the backend unaware of scratch buffers that will never be executed.

### 7.2 Editor contributions

Extend `LayoutEditorContribution` in `src/contracts/extensions/LayoutExtension.ts`:

```ts
type LayoutEditorContribution = {
  id: string;
  title: string;
  order?: number;
  resourceScheme?: string;
  supportedMimeTypes?: string[];
  canSplit?: boolean;
  render: () => ReactNode;
};
```

### 7.3 FilesRegistry API

```ts
type FilesRegistry = {
  registerMimeResolver: (fn: (uri: string, hint?: MimeHint) => string | undefined) => void;
  registerEngineResolver: (fn: (file: FileEntity) => EngineBinding | undefined) => void;
  getEditorState: (fileId: string, editorKey: string) => unknown;
  setEditorState: (fileId: string, editorKey: string, state: unknown) => void;
};
```

Each editor plugin uses its own `editorKey` (e.g., `"monaco.editor"`) to namespace its state within `persistentViewState`.

Engine plugins (`query.payloadbuilder`, `query.jdbc`) register both a mime resolver and an engine resolver. Core remains engine-agnostic.

## 8. Incremental rollout

Five independently merge-able increments. The app stays bootable after each. **Increments 1-4 landed; #5 deferred.**

| # | Increment | Status | Scope |
|---|---|---|---|
| 1 | Core FE registry | done | `core.files` plugin, `FileEntity` type, `FileRegistry`, wired into `PluginContext`. `ShellApp.tsx` now drives tabs from `openFileIds`. |
| 2 | Resolvers + mime | done | `MimeResolver` / `EditorResolver` chains; `LayoutEditorContribution.supportedMimeTypes` added. `dev-query-probe` declares `application/x-payloadbuilder`. |
| 3 | Mediator | done | `FileMediator` with openFile / closeFile / saveFile / notifyChanged / bindEngine / executeFile / reloadFile / acceptExternalChange / discardExternalChange. Backend-sync hook + onFileChanged hook for workspace autosave. Owns the change debouncing. |
| 4 | Protocol + Java registry | done | `file.open/close/bind` requests + `file.change` notification on both sides. Fixtures + Java `ProtocolFixtureCompatibilityTest`. `FileRegistry` + `FileSessionHandler` + `FileSessionHandlerRegistry` SPI in `backend-api`. `DefaultFileRegistry` in `backend-core`. Request/notification handlers in `backend-transport-stdio`. `queryengine.execute` accepts optional `fileId`. |
| 5 | Engine binding + execute | **deferred** | `files.registerEngineResolver`; payloadbuilder implements `FileSessionHandler` and caches parse trees; backend reuses cached parse tree via `queryengine.execute.fileId`. Premature without an editor + output wiring; revisit when those land. |

## 9. Key decisions (locked)

1. **Untitled files** — lazy. No backend session until bound to an engine.
2. **Change debouncing** — owned by the mediator; editor and backend stay simple.
3. **Dirty tracking** — two independent flags, `dirtyVsBackend` and `dirtyVsDisk`.
4. **Registry placement** — new `core.files` plugin, mirroring the backend `FileRegistry` symmetry.

## 10. Contract synchronization rule

When `file.*` protocol shapes change, update both sides in the same session:

- TypeScript contracts: `queryeer-desktop/src/contracts/backend/`
- Java contracts: `queryeer-backend/backend-contract/src/main/java/com/queryeer/backend/contract/file/`

Then update this document and `BACKEND_PROTOCOL.md` to reflect the agreed shape.
