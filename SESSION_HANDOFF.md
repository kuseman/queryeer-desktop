# Session Handoff

## Summary

Refactored the outline plugin to use a generic `EditorRegistry` / `OutlineCapability` architecture, inverting the dependency so editors expose outline support instead of the outline plugin reaching into editor internals.

## Key Architectural Changes

### New Contract: `contracts/editor/EditorCapability.ts`
- `OutlineCapability`: `getSymbols()`, `revealSymbol()`, `onSymbolsChanged()` — the capability interface any editor can implement
- `EditorHandle`: `{ editorId, outline? }` — a generic handle to the active editor
- `EditorRegistry`: `getActiveEditor()`, `onActiveEditorChanged()` — the consumer interface
- `EditorRegistryHost`: extends `EditorRegistry` with `setActiveEditor()` — the producer interface (used by editor plugins)

### Plugin Context
- Added `editors: EditorRegistry` to `PluginContext` — available to all plugins

### Provider Ownership Transfer
- All MIME-type outline providers (json, xml, yaml, sql, custom-pattern) moved from `core.outline/providers/` → `core.editor/TextEditor/outline-providers/`
- `core.editor.text` now registers providers with `context.outline.registerOutlineProvider()`
- `core.outline` no longer imports any providers — it's a pure view plugin
- `OutlineRegistry` remains in `PluginContext` for third-party extensibility

### TextEditor Integration
- `TextEditorOutlineCapability` class implements `OutlineCapability` by delegating to `OutlineRegistry.getSymbols()` and `TextEditorApi` navigation
- `TextEditorComponent` accepts optional `editorRegistryHost`, `outlineRegistry`, and `editorId` props
- On editor ready and on focus, `TextEditorComponent` creates a `TextEditorOutlineCapability` and calls `editorRegistryHost.setActiveEditor(handle)`
- On unmount, calls `editorRegistryHost.setActiveEditor(null)`

### QueryEngine Integration
- `QueryEditorComponent` passes `editorRegistryHost` and `outlineRegistry` props through to `TextEditorComponent`
- Uses `editorId="core.queryengine"` for the query editor handle

### Outline View Simplification
- `OutlineView` now depends only on `EditorRegistry` (from `PluginContext`) — no more `TextEditorRegistry`, `TextEditorApi`, or `TextEditorModelRepository` imports
- Symbol loading: `editorHandle.outline.getSymbols()`
- Navigation: `editorHandle.outline.revealSymbol()`
- Change detection: `editorHandle.outline.onSymbolsChanged()`
- Active editor tracking: `editorRegistry.onActiveEditorChanged()`
- Removed polling/retry logic — the capability only exists once the editor is ready

### OutlineStore Changes
- Replaced `activeFileId`/`activeMimeType` with `hasOutlineCapability` boolean
- `clear()` takes `resetCapability` instead of `resetActiveFile`

## Files Changed

### New Files
- `contracts/editor/EditorCapability.ts` — Editor capability and registry contracts
- `plugins/core.editor/TextEditor/TextEditorOutlineCapability.ts` — Outline capability implementation
- `plugins/core.editor/TextEditor/outline-providers/` — Moved providers + tests + barrel export
- `core/plugin-runtime/EditorRegistry.test.ts` — EditorRegistry tests

### Modified Files
- `contracts/plugin/Plugin.ts` — Added `editors: EditorRegistry` to `PluginContext`
- `core/plugin-runtime/ExtensionRegistry.ts` — Added `EditorRegistryHostImpl`, `createEditorRegistry()`, `getEditorRegistryHost()`
- `core/plugin-runtime/PluginHost.ts` — Added `editors` to plugin context
- `plugins/core.editor/TextEditor/plugin.tsx` — Registers providers, passes editorRegistryHost to component
- `plugins/core.editor/TextEditor/TextEditorComponent.tsx` — Accepts editorRegistryHost/outlineRegistry props, creates/disposes EditorHandle
- `plugins/core.editor/ImageEditor/` — Unchanged (no outline capability yet)
- `plugins/core.queryengine/QueryEditorComponent.tsx` — Accepts and passes editorRegistryHost/outlineRegistry props
- `plugins/core.queryengine/plugin.tsx` — Passes getEditorRegistryHost() and getOutlineRegistry() to QueryEditorComponent
- `plugins/core.outline/plugin.tsx` — Removed all provider registrations; passes context.editors to OutlineView
- `plugins/core.outline/OutlineView.tsx` — Complete rewrite: uses EditorHandle.outline instead of TextEditor internals
- `plugins/core.outline/OutlineStore.ts` — Replaced activeFileId/activeMimeType with hasOutlineCapability
- `plugins/core.outline/OutlineStore.test.ts` — Updated tests for new state shape

### Deleted Files
- `plugins/core.outline/providers/` — Entire directory moved to `core.editor/TextEditor/outline-providers/`

### Test Files Modified
- `plugins/core.layout/plugin.test.ts` — Added `editors` mock to PluginContext
- `plugins/core.queryengine.payloadbuilder/plugin.integration.test.ts` — Added `editors` mock
- `plugins/core.queryengine/engine-registration.test.ts` — Added `editors` mock
- `plugins/core.queryengine/plugin.test.ts` — Added `editors` mock
- `plugins/core.queryengine/QueryEditorComponent.test.tsx` — Added editorRegistryHost/outlineRegistry mock props

## Known Gaps / Future Work

- **Image editor outline**: `core.editor.image` could provide `OutlineCapability` for image metadata (EXIF, dimensions) but doesn't yet
- **`outlineSupported` when-clause**: Still uses `OutlineRegistry.hasProvider(mimeType)` in ShellApp for the sidebar visibility toggle. Could be enhanced to also check `EditorRegistry.getActiveEditor()?.outline` for more accurate detection
- **Editor content without outline**: If an editor type doesn't support outline, the view falls through cleanly (no symbols shown), but `outlineSupported` may still be true based on MIME type alone