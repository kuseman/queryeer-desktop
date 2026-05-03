# Editor Capability Migration Plan — Phase 2

> **Goal**: Eliminate all remaining hard couplings to `TextEditorRegistry`, `TextEditorApi`, `TextEditorModelRepository`,
> and `TextEditorModel` outside their owning module (`core.editor/TextEditor/`). Replace them with capabilities on
> `EditorHandle` and `EditorRegistryHost` so that any future editor type (diagram, image, hex, spreadsheet) can
> participate in the same flows without modifying consumer code.

---

## Current State (Post-Phase-1)

Phase 1 introduced:

- **`EditorHandle`** with optional `outline` capability
- **`EditorRegistryHost`** tracking the active editor handle
- **`EditorRegistry`** (read-only) available via `PluginContext.editors`
- **Outline view** decoupled from `TextEditorRegistry` internals
- **Providers** moved from `core.outline` → `core.editor/TextEditor/outline-providers`

The following external hard couplings remain:

---

## Remaining Couplings

### C1 — `core.queryengine/QueryTextEditorRegistry.ts`

**Current code:**
```ts
import { TextEditorRegistry } from "../core.editor/TextEditor/TextEditorRegistry";
import { registerTextEditorRepository } from "../core.editor/TextEditor/TextEditorModelRepository";

const queryRegistry = new TextEditorRegistry();
registerTextEditorRepository(queryRegistry);
export const queryTextRegistry = queryRegistry;
```

**Problem**: Creates a second `TextEditorRegistry` instance and registers it in the global model-repository list. This is a hidden singleton side-effect that other modules discover by importing the module-level `getTextEditorModelRepositories()`.

**Migration**: The `QueryTextEditorRegistry` stays — it owns the Monaco instance lifecycle for query editors. But instead of exposing the `TextEditorRegistry` directly, it should expose a typed accessor that returns `EditorHandle`-compatible capabilities. The `registerTextEditorRepository` call stays for model lookup (file content resolution), but `QueryEditorComponent` should no longer reach into `TextEditorApi` methods directly.

**Steps:**
1. Keep `QueryTextEditorRegistry.ts` as-is for model management (it's internal to the query engine).
2. Migrate `QueryEditorComponent.tsx` (coulings C5a, C5b below) to use `EditorHandle` capabilities instead of `TextEditorApi` calls.
3. Migrate `PayloadbuilderCatalogSidebar.tsx` (coupling C7) to use `EditorRegistryHost.onActiveEditorChanged()` instead of `queryTextRegistry.subscribe()`.
4. After all consumers are migrated, `queryTextRegistry` can remain as an internal implementation detail — only the leaking of `TextEditorApi` method calls needs to stop.

---

### C2 — `core.files/plugin.tsx`

**Current code (lines 5, 84-95, 217):**
```ts
import { getTextEditorRegistry } from "../core.editor/TextEditor/TextEditorRegistry";
// ...
const textEditorRegistry = getTextEditorRegistry();
const activeFile = textEditorRegistry.getActiveFile();
const editor = textEditorRegistry.getActiveEditor();
// editor.format() called for format-on-save
// ...
const activeFromEditor = getTextEditorRegistry().getActiveFile();
```

**Problem**: The `core.files` plugin directly reaches into `TextEditorRegistry` to:
- Get the active editor to invoke `.format()` (format on save)
- Get the active file as a fallback when `FileMediator.getActiveFileId()` returns null

**Migration:**

1. **Format-on-save** → Add a `FormatCapability` to `EditorHandle`:
   ```ts
   export type FormatCapability = {
     format(): Promise<void>;
   };

   export type EditorHandle = {
     readonly editorId: string;
     outline?: OutlineCapability;
     format?: FormatCapability;   // NEW
   };
   ```
   The `TextEditorOutlineCapability` file becomes a broader `TextEditorCapabilities.ts` that also creates `FormatCapability`. The `core.files` plugin calls `context.editors.getActiveEditor()?.format?.format()` instead of `getTextEditorRegistry().getActiveEditor()?.format()`.

2. **Active file fallback** → This is really about knowing which file is active in the editor scope. The `FileMediator` already provides `getActiveFileId()`. The fallback path (`getTextEditorRegistry().getActiveFile()`) should be removed or replaced with `EditorRegistryHost.getActiveEditor()` yielding an `EditorHandle` that carries a `fileId`. But `EditorHandle` currently doesn't carry `fileId` — that needs adding.

**Steps:**
1. Add `fileId: string | null` to `EditorHandle` and have `TextEditorComponent` populate it from the active file.
2. Add `FormatCapability` to `contracts/editor/EditorCapability.ts`.
3. Implement `FormatCapability` in `TextEditorComponent` (wrapping `editor.format()`).
4. Rewrite `core.files/plugin.tsx` format-on-save command to use `context.editors.getActiveEditor()?.format?.format()`.
5. Remove the `getTextEditorRegistry().getActiveFile()` fallback — use `FileMediator` directly.

---

### C3 — `renderer/shell/bootstrap.ts`

**Current code (lines 14-15, 41, 79-86, 100, 230, 237):**
```ts
import { getTextEditorModelRepositories, getTextEditorRepositoryStates } from "...TextEditorModelRepository";
import { setTextEditorContextChain } from "...TextEditorRegistry";
// ...
setTextEditorContextChain(chain);
// ...
for (const repo of getTextEditorModelRepositories()) {
  const model = repo.getModelForFile(fileId) ?? repo.getModelForUri(uri);
  if (model) return model.getContent();
}
// ...
for (const repo of getTextEditorRepositoryStates()) {
  repo.updateModelContent(file.uri, text);
}
// ...
for (const repo of getTextEditorRepositoryStates()) {
  repo.applyRecoveredContent(fileId, text);
}
// ...
for (const repo of getTextEditorRepositoryStates()) {
  repo.onContentDirty((fileId, text) => { ... });
}
```

**Problem**: Bootstrap directly iterates the model-repository list for:
- `resolveFileContent(fileId, uri)` — file content resolution for backend sync
- `updateModelContent(uri, text)` — pushing backend changes to editor models
- `applyRecoveredContent(fileId, text)` — workspace restore
- `onContentDirty(fileId, text)` — dirty-state tracking

These are model-lifecycle concerns that should be capabilities on the editor registry, not leaked through a module-level accessor.

**Migration:**

Add `ContentCapability` to `EditorHandle` and `ContentSync` methods to `EditorRegistryHost`:

```ts
export type ContentCapability = {
  getContent(): string;
  setContent(content: string): void;
};

export type EditorHandle = {
  readonly editorId: string;
  readonly fileId: string | null;
  outline?: OutlineCapability;
  format?: FormatCapability;
  content?: ContentCapability;
};

// On EditorRegistryHost:
export type EditorRegistryHost = EditorRegistry & {
  setActiveEditor(handle: EditorHandle | null): void;
  resolveFileContent(fileId: string, uri: string): string | undefined;
  broadcastContentUpdate(uri: string, content: string): void;
  applyRecoveredContent(fileId: string, content: string): void;
  onContentDirty(listener: (fileId: string, text: string) => void): () => void;
};
```

The `EditorRegistryHostImpl` implementation would delegate to its registered `ContentCapability` providers and fall back to iterating known model repositories (which it can hold internally).

**Steps:**
1. Add `ContentCapability` and `FormatCapability` types to `contracts/editor/EditorCapability.ts`.
2. Add `fileId`, `format`, and `content` to `EditorHandle`.
3. Add `resolveFileContent`, `broadcastContentUpdate`, `applyRecoveredContent`, `onContentDirty` to `EditorRegistryHost`.
4. Implement the methods in `EditorRegistryHostImpl` by iterating registered `ContentCapability` providers.
5. Have `TextEditorComponent` populate `content` and `fileId` on the `EditorHandle`.
6. Rewrite `bootstrap.ts` to use `editorRegistryHost.resolveFileContent()` etc. instead of `getTextEditorModelRepositories()`.
7. Remove `setTextEditorContextChain` from bootstrap — context-chain wiring moves into `EditorRegistryHost` initialization.

---

### C4 — `renderer/workspace/workspace-service.ts`

**Current code (lines 16-17, 108, 625-628):**
```ts
import { getTextEditorRegistry } from "...TextEditorRegistry";
import { getTextEditorRepositoryStates } from "...TextEditorModelRepository";
// ...
for (const repo of getTextEditorRepositoryStates()) {
  repo.applyRecoveredContent(fileId, text);
}
// ...
const textRegistry = getTextEditorRegistry() as unknown as {
  getActiveFile?: () => { fileId?: string } | null;
};
const textEditorActiveFileId = textRegistry.getActiveFile?.()?.fileId ?? null;
```

**Problem**: Workspace service uses `getTextEditorRepositoryStates()` for backup restore and `getTextEditorRegistry()` with an unsafe cast to check `isActiveFile()`.

**Migration:**
1. Replace `getTextEditorRepositoryStates().applyRecoveredContent()` loop with `context.editors.applyRecoveredContent(fileId, text)` (or a host-level method if editors aren't plugins).
2. Replace the type-unsafe `getActiveFile()` cast with `context.editors.getActiveEditor()?.fileId` to determine if the active editor has the file.

**Steps:**
1. The workspace service receives the `EditorRegistryHost` in its constructor options (via bootstrap).
2. Replace `applyRecoveredContent` loop with `editorRegistryHost.applyRecoveredContent(fileId, text)`.
3. Replace `getActiveFile()` cast with `editorRegistryHost.getActiveEditor()?.fileId`.
4. Update workspace-service tests to mock `EditorRegistryHost` instead of `TextEditorRegistry`.

---

### C5 — `core.queryengine/QueryEditorComponent.tsx`

**Current code (lines 74, 144-147, 379-384):**
```ts
import { queryTextRegistry } from "./QueryTextEditorRegistry";
// ...
queryTextRegistry.getActiveEditor()?.focus();
// ...
const editor = queryTextRegistry.getActiveEditor();
const text = editor.getSelectedText() ?? editor.getContent();
// ...
<TextEditorComponent file={file} registry={queryTextRegistry}
  editorRegistryHost={getEditorRegistryHost()} outlineRegistry={getOutlineRegistry()}
  editorId="core.queryengine" />
```

**Problem**: Two direct `TextEditorApi` method calls:
- `getActiveEditor()?.focus()` — for refocusing the editor after tab switch (line 74)
- `getActiveEditor()` → `getSelectedText() ?? getContent()` — for extracting query text to execute (lines 144-147)

**Migration:**

Add `FocusCapability` and `SelectionCapability` to `EditorHandle`:

```ts
export type FocusCapability = {
  focus(): void;
};

export type SelectionCapability = {
  getSelectedText(): string | null;
  getContent(): string;
};

export type EditorHandle = {
  readonly editorId: string;
  readonly fileId: string | null;
  outline?: OutlineCapability;
  format?: FormatCapability;
  content?: ContentCapability;
  focus?: FocusCapability;
  selection?: SelectionCapability;
};
```

**Steps:**
1. Add `FocusCapability` and `SelectionCapability` types to `contracts/editor/EditorCapability.ts`.
2. Implement in `TextEditorComponent` — populate `focus` and `selection` on the `EditorHandle`.
3. In `QueryEditorComponent.tsx`, replace:
   - `queryTextRegistry.getActiveEditor()?.focus()` → `context.editors.getActiveEditor()?.focus?.focus()`
   - `editor.getSelectedText() ?? editor.getContent()` → `const h = context.editors.getActiveEditor(); h?.selection?.getSelectedText() ?? h?.selection?.getContent() ?? ""`
4. The `queryTextRegistry` still needs to be passed to `TextEditorComponent` for model management, but `QueryEditorComponent` no longer calls `TextEditorApi` methods directly.

---

### C7 — `core.queryengine.payloadbuilder/PayloadbuilderCatalogSidebar.tsx`

**Current code (lines 2, 13, 21-22):**
```ts
import { queryTextRegistry } from "../core.queryengine/QueryTextEditorRegistry";
// ...
const file = queryTextRegistry.getActiveFile();
// ...
const sub = registry.subscribe(() => {
  const file = registry.getActiveFile();
  // ...
});
```

**Problem**: Uses `TextEditorRegistry.getActiveFile()` and `subscribe()` to track which file is active in the query editor.

**Migration:**
1. Replace `queryTextRegistry.getActiveFile()` → `editorRegistryHost.getActiveEditor()` and use `.fileId` to look up the file from `FilesRegistry`.
2. Replace `queryTextRegistry.subscribe()` → `editorRegistryHost.onActiveEditorChanged()`.
3. Pass `EditorRegistryHost` as a prop to `PayloadbuilderCatalogSidebar` (or via context).

**Steps:**
1. Add `EditorRegistryHost` prop to `PayloadbuilderCatalogSidebar`.
2. Use `editorRegistryHost.onActiveEditorChanged()` + `editorRegistryHost.getActiveEditor()?.fileId` instead of `queryTextRegistry`.
3. Update tests.

---

### C6 — `core.queryengine/plugin.tsx`

**Current code (line 57):**
```ts
queryTextRegistry.setFilesRegistry(context.files);
```

**Problem**: Initializes the query editor's `TextEditorRegistry` with a `FilesRegistry`. This is internal to the `TextEditorRegistry` and stays internal — it's part of the registry's own lifecycle, not a cross-boundary coupling that consumers reach through.

**Assessment**: **LEGITIMATE INTERNAL USE** — `setFilesRegistry` is called on the private `queryTextRegistry` instance within the query engine plugin. This is the owning module setting up its own registry. **No migration needed.**

---

## Capability Additions Summary

| Capability | Methods | Added To | Used By |
|---|---|---|---|
| `FormatCapability` | `format(): Promise<void>` | `EditorHandle` | C2 — `core.files` format-on-save |
| `ContentCapability` | `getContent(): string`, `setContent(content: string): void` | `EditorHandle` | C3 — `bootstrap.ts` file resolution, content push |
| `FocusCapability` | `focus(): void` | `EditorHandle` | C5 — `QueryEditorComponent` tab-switch refocus |
| `SelectionCapability` | `getSelectedText(): string \| null`, `getContent(): string` | `EditorHandle` | C5 — `QueryEditorComponent` query execution |
| `fileId` field | `fileId: string \| null` | `EditorHandle` | C2, C4 — active file identification |
| Host-level methods | `resolveFileContent()`, `broadcastContentUpdate()`, `applyRecoveredContent()`, `onContentDirty()` | `EditorRegistryHost` | C3, C4 — bootstrap/workspace content sync |

---

## Implementation Order

### Step 1 — Add capability types to contract

**File**: `contracts/editor/EditorCapability.ts`

Add `FormatCapability`, `ContentCapability`, `FocusCapability`, `SelectionCapability` types. Add `fileId`, `format`, `content`, `focus`, `selection` fields to `EditorHandle`. Add host-level methods to `EditorRegistryHost`.

### Step 2 — Implement capabilities in `TextEditorComponent`

**File**: `plugins/core.editor/TextEditor/TextEditorComponent.tsx`

- Populate `fileId` from the active file.
- Create `FormatCapability` wrapping `api.format()`.
- Create `ContentCapability` wrapping `model.getContent()` / `model.setContent()`.
- Create `FocusCapability` wrapping `api.focus()`.
- Create `SelectionCapability` wrapping `api.getSelectedText()` / `api.getContent()`.
- Pass all capabilities via `createTextEditorHandle()`.

Update `TextEditorOutlineCapability.ts` → rename to `TextEditorCapabilities.ts` (or keep separate files; preference is to keep them separate for SRP).

### Step 3 — Implement host-level methods in `EditorRegistryHostImpl`

**File**: `core/plugin-runtime/ExtensionRegistry.ts`

- `resolveFileContent(fileId, uri)` — iterates registered `ContentCapability` providers, falls back to iterating known model repositories.
- `broadcastContentUpdate(uri, content)` — iterates `ContentCapability` providers.
- `applyRecoveredContent(fileId, content)` — iterates `ContentCapability` providers.
- `onContentDirty(listener)` — subscribes to content-dirty events from all providers.

### Step 4 — Migrate `core.files/plugin.tsx` (C2)

- Replace `getTextEditorRegistry().getActiveEditor()?.format()` with `context.editors.getActiveEditor()?.format?.format()`.
- Remove `getTextEditorRegistry()` import.
- Remove `getTextEditorRegistry().getActiveFile()` fallback, use `FileMediator` directly.

### Step 5 — Migrate `renderer/shell/bootstrap.ts` (C3)

- Replace `getTextEditorModelRepositories()` content-resolution loop with `editorRegistryHost.resolveFileContent()`.
- Replace `getTextEditorRepositoryStates().updateModelContent()` with `editorRegistryHost.broadcastContentUpdate()`.
- Replace `getTextEditorRepositoryStates().applyRecoveredContent()` with `editorRegistryHost.applyRecoveredContent()`.
- Replace `getTextEditorRepositoryStates().onContentDirty()` with `editorRegistryHost.onContentDirty()`.
- Replace `setTextEditorContextChain(chain)` with context-chain wiring on `EditorRegistryHost`.
- Remove all `TextEditorRegistry`/`TextEditorModelRepository` imports.

### Step 6 — Migrate `renderer/workspace/workspace-service.ts` (C4)

- Replace `getTextEditorRepositoryStates().applyRecoveredContent()` loop with `hostOptions.applyRecoveredContent` (via `EditorRegistryHost`).
- Replace `getTextEditorRegistry()` unsafe cast with `hostOptions.editorRegistryHost.getActiveEditor()?.fileId`.
- Update constructor options type.
- Update tests.

### Step 7 — Migrate `core.queryengine/QueryEditorComponent.tsx` (C5)

- Replace `queryTextRegistry.getActiveEditor()?.focus()` with `editorRegistryHost.getActiveEditor()?.focus?.focus()`.
- Replace `editor.getSelectedText() ?? editor.getContent()` with `editorHandle.selection?.getSelectedText() ?? editorHandle.selection?.getContent()`.
- `queryTextRegistry` stays as a prop to `TextEditorComponent` for model management.
- Update tests.

### Step 8 — Migrate `core.queryengine.payloadbuilder/PayloadbuilderCatalogSidebar.tsx` (C7)

- Replace `queryTextRegistry.getActiveFile()` with `editorRegistryHost.getActiveEditor()` → lookup file from `FilesRegistry`.
- Replace `queryTextRegistry.subscribe()` with `editorRegistryHost.onActiveEditorChanged()`.
- Pass `EditorRegistryHost` as prop.
- Update tests.

### Step 9 — Migrate `core.queryengine/plugin.tsx` for outline (already done in Phase 1)

- Already migrated: `plugin.tsx` passes `editorRegistryHost` and `outlineRegistry` to `QueryEditorComponent`.

### Step 10 — Clean up module-level singletons

After all consumers are migrated:
- Remove `getTextEditorRegistry()` module-level singleton export from `TextEditorRegistry.ts` (make it private to the text editor plugin).
- Remove `getTextEditorModelRepositories()` / `getTextEditorRepositoryStates()` module-level exports (make repository management internal).
- Remove `setTextEditorContextChain()` module-level export (move to `EditorRegistryHost` initialization).
- Remove `getAnyActiveEditor()` module-level export.
- Remove `globalEditorByScopeId` module-level map.

---

## Test Updates Required

| Test File | What Changes |
|---|---|
| `renderer/workspace/workspace-service.test.ts` | Mock `EditorRegistryHost` instead of `getTextEditorRegistry` / `getTextEditorRepositoryStates` |
| `core.queryengine/QueryEditorComponent.test.tsx` | Already updated in Phase 1 — add `focus` / `selection` capability mocks |
| `core.queryengine/plugin.test.ts` | Add `editors` mock to `PluginContext` (already done in Phase 1) |
| `core.queryengine/payloadbuilder/PayloadbuilderCatalogSidebar.test.tsx` | Mock `EditorRegistryHost` instead of `queryTextRegistry` |
| `core.files/plugin.test.ts` | Mock `EditorRegistry` instead of `getTextEditorRegistry` |

---

## Verification Checklist

After each step:

1. `npm run typecheck` — must pass
2. `npm run lint` — must pass
3. `npm run build` — must pass
4. `npm run test` — all 610+ tests must pass
5. No remaining `import ... from "...TextEditorRegistry"` outside `core.editor/TextEditor/` and `core.queryengine/QueryTextEditorRegistry.ts`
6. No remaining `import ... from "...TextEditorModelRepository"` outside `core.editor/TextEditor/` and `core.queryengine/QueryTextEditorRegistry.ts`
7. No remaining `getTextEditorRegistry()` calls outside `core.editor/TextEditor/` and `core.queryengine/`

---

## Files NOT Changed

These files use `TextEditorRegistry` / `TextEditorApi` legitimately within the owning module:
- `plugins/core.editor/TextEditor/TextEditorRegistry.ts` — the registry itself
- `plugins/core.editor/TextEditor/TextEditorApi.ts` — the API
- `plugins/core.editor/TextEditor/TextEditorModel.ts` — the model
- `plugins/core.editor/TextEditor/TextEditorModelRepository.ts` — the repository
- `plugins/core.editor/TextEditor/TextEditorComponent.tsx` — the component
- `plugins/core.editor/TextEditor/TextEditorOutlineCapability.ts` — the capability impl
- `plugins/core.editor/TextEditor/MonacoTextEditorApi.ts` — the Monaco impl
- `plugins/core.editor/TextEditor/ViewStateStore.ts` — view state
- `plugins/core.editor/TextEditor/commands.ts` — editor commands
- `plugins/core.editor/TextEditor/keybindings.ts` — keybindings
- `plugins/core.editor/TextEditor/TextEditorRegistry.test.ts` — registry tests
- `plugins/core.editor/TextEditor/TextEditorComponent.integration.test.tsx` — integration tests
- `plugins/core.editor/TextEditor/editor-settings.ts` — settings
- `plugins/core.editor/TextEditor/mime-types.ts` — MIME registration
- `core.queryengine/QueryTextEditorRegistry.ts` — scoped registry (keeps internal `TextEditorRegistry` usage)