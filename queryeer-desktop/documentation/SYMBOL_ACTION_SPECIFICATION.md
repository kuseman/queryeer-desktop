# Symbol Action Specification

## 1. Overview

Add a rule-based query system that lets users configure context menu actions bound to symbols in the text editor. When a user right-clicks on a symbol (table, view, function, etc.), matching actions appear in Monaco's context menu and execute a parameterized query against the connected engine.

Example: a "Describe" action for SQL Server tables:

- **Label**: Describe
- **When**: `activeFile.mimeType == 'application/sql' && activeFile.metadata.core.queryengine.jdbc.dialectId == 'sqlserver' && symbol.kind == 'table'`
- **Query**: `exec sp_help ${symbol.name}`

### Module ownership

| Module | Owns | Does NOT own |
|--------|------|-------------|
| `core.editor.texteditor` | `onContextMenu` event on `TextEditorApi`, `ContextMenuRegistry` extension point on `PluginContext`, coordination logic in `TextEditorComponent` (collect items from providers, inject into Monaco context menu, dispose) | Symbol action logic, backend invoke, query execution, when-expression evaluation |
| `core.queryengine` | `SymbolAction` type, `SymbolActionRegistry`, `SymbolActionProvider` (implements `ContextMenuProvider`), backend invoke for `sql.symbolAtPosition`, settings UI, when-expression variable registration, template interpolation, query execution | Editor API, Monaco integration, context menu coordination |

The editor module provides a generic context menu extension point. The query engine module is the first consumer, registering a `ContextMenuProvider` that contributes symbol actions. Any future plugin can use the same `ContextMenuRegistry` to add its own context menu items.

### Key design decisions

1. **Backend-only symbol resolution** — symbol kind/name/detail at cursor position is resolved via a `sql.symbolAtPosition` backend invoke. No client-side outline fallback. If the backend is unavailable, no symbol actions appear in the context menu.
2. **No action if a query is already running** on the active file.
3. **Results route to a configurable output contributor** (defaults to primary table output). The current editor content is untouched.
4. **Template interpolation uses `${symbol.kind}`, `${symbol.name}`, `${symbol.detail}`** — forward-compatible with future template engines. Unknown placeholders are left as-is (not stripped).
5. **When-expression context variables** use dotted notation (`symbol.kind`, `symbol.name`, `symbol.detail`) and structured file context (`activeFile.metadata.*`). The existing `activeFile.metadata.core.queryengine.jdbc.dialectId` is already in the context chain — no new variable needed for dialect.
6. **All actions are user-configured in settings** — no plugin-registered defaults. Settings use an advanced renderer under "Query Engine > Symbol Actions".
7. **`SqlCompletionContext`** on the backend should be renamed to a more general name (e.g., `SqlParseContext`) since it will serve both completion and symbol navigation.

### Phase 1 (this spec)

- `ContextMenuRegistry` extension point (contract + implementation).
- `onContextMenu` on `TextEditorApi`.
- `SymbolActionProvider` in `core.queryengine` that implements `ContextMenuProvider`.
- `SymbolActionRegistry` module-level singleton in `core.queryengine`.
- Settings contributor with advanced renderer for CRUD editing of symbol actions.
- `sql.symbolAtPosition` invoke action (frontend contract; backend implementation is a separate task).

### Phase 2 (deferred)

- Monaco `DefinitionProvider` bridge (Ctrl+Click / F12 powered by `sql.symbolAtPosition`).
- Monaco `HoverProvider` bridge (tooltip on hover showing symbol actions).
- Advanced template engine with conditional logic.

---

## 2. Architecture

### Context menu extension point (`core.editor.texteditor`)

```
┌──────────────────────────────────────────────────────────────┐
│  ContextMenuRegistry (contract, on PluginContext)            │
│  registerProvider(provider: ContextMenuProvider)              │
│  unregisterProvider(id: string)                                │
│  getProviders() → ContextMenuProvider[]                        │
└───────────────┬──────────────────────────────────────────────┘
                │
       ┌────────┴──────────────────┐
       ▼                           ▼
  core.queryengine            (future plugins
  registers a                   can register
  ContextMenuProvider            their own)
```

### Context menu coordination (`core.editor.texteditor`)

```
User right-clicks in editor
  → Monaco fires onContextMenu event
  → TextEditorComponent coordination:
      1. Dispose previous dynamic Monaco actions
      2. Build ContextMenuContext { position, range, editorApi, file }
      3. For each registered ContextMenuProvider:
           items = await provider.getItems(context)
      4. For each ContextMenuItem:
           editor.addAction({ id, label, contextMenuGroupId, order, run })
      5. Monaco displays context menu with injected actions

On next right-click or editor disposal:
  → Dispose all dynamic Monaco actions
```

### Symbol action provider (`core.queryengine`)

```
┌──────────────────────────────────────────────────────────────┐
│  SymbolActionRegistry (module-level singleton)                │
│  getSymbolActions() → SymbolAction[]                          │
│  (populated from settings, updated on change)                 │
└───────────────┬──────────────────────────────────────────────┘
                │ reads from
                ▼
         Settings (JSON)

┌──────────────────────────────────────────────────────────────┐
│  SymbolActionProvider implements ContextMenuProvider           │
│                                                               │
│  getItems(context: ContextMenuContext):                       │
│  1. If backend not healthy or query running → return []       │
│  2. Invoke backend: sql.symbolAtPosition                    │
│  3. If null → return []                                        │
│  4. Inject symbol context into EDITOR_INSTANCE scope          │
│  5. Evaluate each action.when against context chain            │
│  6. Clear symbol context                                      │
│  7. Return matching actions as ContextMenuItem[]               │
│                                                               │
│  On item.run():                                               │
│  1. Interpolate query template with symbol result              │
│  2. Execute via QueryEngineService.execute()                   │
│  3. Route results to action.outputId (default: primary)       │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. New Contract Types

### 3.1 `src/contracts/extensions/ContextMenuExtension.ts` (NEW)

Generic context menu extension point. Any plugin can register a `ContextMenuProvider` to contribute items to the text editor's right-click menu.

```ts
import type { Position, Range } from "../editor/EditorApi";

/** Context provided to ContextMenuProvider when the context menu is about to open. */
export type ContextMenuContext = {
  /** Position of the cursor when the context menu was requested. */
  position: Position;
  /** Range of the selection at the context menu position, if any. */
  selection: Range | null;
  /** MIME type of the active file. */
  mimeType: string | null;
  /** File ID of the active file. */
  fileId: string | null;
};

/** A single item to display in the editor context menu. */
export type ContextMenuItem = {
  /** Unique identifier for this menu item. */
  id: string;
  /** Display label. */
  label: string;
  /** Sort order within the context menu group. Lower = higher priority. */
  order?: number;
  /** Run when the user clicks this menu item. */
  run(): void;
};

/** Provider of context menu items. Called by the editor when the context menu opens. */
export type ContextMenuProvider = {
  /** Unique identifier for this provider. */
  id: string;
  /** Called when the context menu is about to open. Return items to inject. */
  getItems(context: ContextMenuContext): Promise<ContextMenuItem[]>;
};

/** Registry for context menu providers, exposed on PluginContext. */
export type ContextMenuRegistry = {
  registerProvider(provider: ContextMenuProvider): void;
  unregisterProvider(id: string): void;
};
```

Design decisions:

- **`ContextMenuProvider` is async** — providers may need to call the backend (e.g., resolve symbol at position) before deciding which items to return.
- **`ContextMenuContext` carries MIME type and file ID** — so providers can filter by file type without needing direct access to the file registry.
- **`ContextMenuItem.run()` is a closure** — it captures all needed data at creation time (symbol, action, editor state). The editor coordination layer calls `addAction()` with the closure as `run`.

### 3.2 `src/contracts/editor/EditorApi.ts` (MODIFY)

Add context menu event type (used internally by `TextEditorComponent`, not part of the public `ContextMenuProvider` interface):

```ts
export type EditorContextMenuEvent = {
  event: {
    x: number;
    y: number;
  };
  target: {
    position: Position | null;
    range: Range | null;
  };
};
```

### 3.3 `src/contracts/plugin/Plugin.ts` (MODIFY)

Add `contextMenu` to `PluginContext`:

```ts
import type { ContextMenuRegistry } from "../extensions/ContextMenuExtension";

export type PluginContext = {
  commands: CommandRegistry;
  filesystems: FileSystemRegistry;
  files: FilesRegistry;
  fileState: FileStateRegistry;
  fileMediator: FileMediator;
  fileWatcher: FileWatcherService;
  layout: LayoutRegistry;
  menu: MenuRegistry;
  keybindings: KeybindingRegistry;
  dialog: DialogRegistry;
  tooltip: TooltipRegistry;
  settings: SettingsRegistry;
  quickcommand: QuickCommandRegistry;
  outline: OutlineRegistry;
  contextMenu: ContextMenuRegistry;  // ← NEW
};
```

### 3.4 `src/contracts/backend/Types.ts` (MODIFY)

Add types for the backend invoke contract:

```ts
export type SymbolAtPositionInvokePayload = {
  fileId?: string;
  text?: string;
  cursor: { line: number; column: number };
  connectionId?: string;
  database?: string;
};
```

(`SymbolAtPositionInvokeResult` reuses `SymbolAtPositionResult` from `core.queryengine`'s local types — it's not a contract type since no other plugin needs it.)

---

## 4. `core.editor.texteditor` — New and Modified Files

### 4.1 `src/contracts/extensions/ContextMenuExtension.ts` (NEW)

See section 3.1 for full type definitions.

### 4.2 `src/plugins/core.editor/texteditor/TextEditorApi.ts` (MODIFY)

**Add** abstract method:

```ts
abstract onContextMenu(callback: (event: EditorContextMenuEvent) => void): Disposable;
```

### 4.3 `src/plugins/core.editor/texteditor/MonacoTextEditorApi.ts` (MODIFY)

**Implement** `onContextMenu()`:

```ts
onContextMenu(callback: (event: EditorContextMenuEvent) => void): Disposable {
  if (!this.editor) return { dispose: () => {} };
  const d = this.editor.onContextMenu((e) => {
    callback({
      event: {
        x: e.event.posx,
        y: e.event.posy
      },
      target: {
        position: e.target.position
          ? { lineNumber: e.target.position.lineNumber, column: e.target.position.column }
          : null,
        range: e.target.range
          ? {
              startLineNumber: e.target.range.startLineNumber,
              startColumn: e.target.range.startColumn,
              endLineNumber: e.target.range.endLineNumber,
              endColumn: e.target.range.endColumn
            }
          : null
      }
    });
  });
  return { dispose: () => d.dispose() };
}
```

### 4.4 `src/plugins/core.editor/texteditor/TextEditorComponent.tsx` (MODIFY)

**Wire** context menu coordination. On right-click, the component:

1. Disposes previous dynamic Monaco actions.
2. Builds `ContextMenuContext` from the event.
3. Calls all registered `ContextMenuProvider`s to collect items.
4. Registers each item as a Monaco action with `contextMenuGroupId: '9_extensions'`.
5. Monaco displays the context menu (the native `onContextMenu` event fires after our actions are registered).

```ts
// Pseudocode for the coordination logic in TextEditorComponent:

const dynamicMenuDisposables: { dispose(): void }[] = [];

async function handleContextMenu(event: EditorContextMenuEvent): void {
  // 1. Dispose previous dynamic actions
  for (const d of dynamicMenuDisposables) { d.dispose(); }
  dynamicMenuDisposables.length = 0;

  const position = event.target.position;
  if (!position) return;

  // 2. Build context
  const file = activeFile; // from the component's state
  const context: ContextMenuContext = {
    position: { lineNumber: position.lineNumber, column: position.column },
    selection: /* from editor.getSelection() */ null,
    mimeType: file?.mimeType ?? null,
    fileId: file?.fileId ?? null
  };

  // 3. Collect items from all providers
  const providers = getContextMenuRegistry().getProviders();
  for (const provider of providers) {
    try {
      const items = await provider.getItems(context);
      for (const item of items) {
        const disposable = editor.addAction({
          id: `queryeer-ctx-${item.id}`,
          label: item.label,
          contextMenuGroupId: "9_extensions",
          contextMenuOrder: item.order ?? 0,
          run: () => item.run()
        });
        dynamicMenuDisposables.push(disposable);
      }
    } catch {
      // Provider errors should not break other providers or the menu
    }
  }
}
```

### 4.5 `src/core/plugin-runtime/ExtensionRegistry.ts` (MODIFY)

**Add** `createContextMenuRegistry()` factory method:

```ts
private contextMenuProviders: ContextMenuProvider[] = [];

createContextMenuRegistry(): ContextMenuRegistry {
  return {
    registerProvider: (provider: ContextMenuProvider) => {
      if (this.contextMenuProviders.some(p => p.id === provider.id)) {
        console.warn(`Context menu provider '${provider.id}' already registered; overwriting.`);
      }
      this.contextMenuProviders = [
        ...this.contextMenuProviders.filter(p => p.id !== provider.id),
        provider
      ];
    },
    unregisterProvider: (id: string) => {
      this.contextMenuProviders = this.contextMenuProviders.filter(p => p.id !== id);
    }
  };
}

getContextMenuProviders(): ContextMenuProvider[] {
  return [...this.contextMenuProviders];
}
```

Note: `getProviders()` is NOT on the `ContextMenuRegistry` contract — it's an implementation detail. The `TextEditorComponent` accesses providers through a module-level accessor (similar to how `getQueryEngineService()` works).

### 4.6 `src/core/plugin-runtime/PluginHost.ts` (MODIFY)

**Wire** `contextMenu` registry into plugin context:

```ts
const context: PluginContext = {
  // ... existing fields ...
  contextMenu: this.extensionRegistry.createContextMenuRegistry(),
};
```

### 4.7 `src/contracts/editor/EditorApi.ts` (MODIFY)

Add the `EditorContextMenuEvent` type (see section 3.2).

### 4.8 `src/contracts/plugin/Plugin.ts` (MODIFY)

Add `contextMenu: ContextMenuRegistry` to `PluginContext` (see section 3.3).

---

## 5. `core.queryengine` — New and Modified Files

### 5.1 `src/plugins/core.queryengine/symbol-action-types.ts` (NEW)

Local type definitions for symbol actions. Not in contracts because no other plugin needs them.

```ts
export type SymbolAction = {
  /** Unique identifier for this action. */
  id: string;
  /** Display label shown in the context menu. */
  label: string;
  /** When-expression that must evaluate to true for this action to appear.
   *  Available context variables:
   *    - activeFile.mimeType
   *    - activeFile.metadata.core.queryengine.jdbc.dialectId
   *    - activeFile.metadata.core.queryengine.jdbc.database
   *    - symbol.kind   (injected at right-click)
   *    - symbol.detail  (injected at right-click)
   *    - symbol.name    (injected at right-click)
   *    - ... plus all existing context variables
   */
  when: string;
  /** Query template. Supports ${symbol.name}, ${symbol.kind}, ${symbol.detail}.
   *  Unknown placeholders are left as-is. */
  query: string;
  /** Output contributor ID to route results to. Defaults to primary table output. */
  outputId?: string;
  /** Sort order within the context menu group. Lower = higher priority. */
  order?: number;
  /** Icon name for the context menu item (reserved for future use). */
  icon?: string;
};

export type SymbolAtPositionResult = {
  /** Engine-specific symbol kind (e.g. "table", "view", "column", "function", "schema"). */
  kind: string;
  /** Fully qualified symbol name (e.g. "dbo.MyTable"). */
  name: string;
  /** Additional detail (e.g. "TABLE", "VIEW"). */
  detail?: string;
  /** Range of the symbol in the document, if known. */
  range?: TextRange;
};

/** Setting ID for user-configured symbol actions. */
export const SYMBOL_ACTIONS_SETTING_ID = "core.queryengine.symbolActions";
```

### 5.2 `src/plugins/core.queryengine/symbol-action-registry.ts` (NEW)

Module-level singleton registry for symbol actions. Read from settings; updated when settings change.

```ts
import type { SymbolAction } from "./symbol-action-types";

type ChangeListener = () => void;

class SymbolActionRegistryImpl {
  private actions: SymbolAction[] = [];
  private listeners: ChangeListener[] = [];

  getSymbolActions(): SymbolAction[] {
    return [...this.actions];
  }

  setActions(actions: SymbolAction[]): void {
    this.actions = actions;
    for (const listener of this.listeners) {
      listener();
    }
  }

  onDidChangeActions(callback: ChangeListener): { dispose(): void } {
    this.listeners.push(callback);
    return { dispose: () => { this.listeners = this.listeners.filter(l => l !== callback); } };
  }
}

let instance: SymbolActionRegistryImpl | undefined;

export function getSymbolActionRegistry(): SymbolActionRegistryImpl {
  if (!instance) {
    instance = new SymbolActionRegistryImpl();
  }
  return instance;
}
```

This follows the same module-level singleton pattern as `QueryEngineService`.

### 5.3 `src/plugins/core.queryengine/symbol-action-provider.ts` (NEW)

Implements `ContextMenuProvider`. Resolves symbol at position, evaluates when clauses, returns matching actions.

```ts
import type { ContextMenuProvider, ContextMenuContext, ContextMenuItem } from "../../contracts/extensions/ContextMenuExtension";
import type { SymbolAction, SymbolAtPositionResult } from "./symbol-action-types";
import { resolveSymbolAtPosition } from "./symbol-action-invoke";
import { getSymbolActionRegistry } from "./symbol-action-registry";
import { evaluateWhenExpression } from "../core.commands/when-evaluator";
import { getCommandContextValues } from "../core.commands/command-context-accessor";
import { getContextChain } from "../core.commands/context-chain";

type SymbolActionProviderDeps = {
  getFile: (fileId: string) => FileEntity | undefined;
  getModelContent: () => string | undefined;
  isQueryRunning: (fileId: string) => boolean;
  executeQuery: (fileId: string, query: string, outputId?: string) => Promise<void>;
  scopeId: string;
  contextValueFlatten: (prefix: string, obj: unknown) => Record<string, string | number | boolean | undefined>;
};

export class SymbolActionProvider implements ContextMenuProvider {
  readonly id = "core.queryengine.symbolActions";
  private deps: SymbolActionProviderDeps;

  constructor(deps: SymbolActionProviderDeps) {
    this.deps = deps;
  }

  async getItems(context: ContextMenuContext): Promise<ContextMenuItem[]> {
    // No file context → no actions
    if (!context.fileId || !context.mimeType) return [];

    // No actions if a query is already running on the active file
    if (this.deps.isQueryRunning(context.fileId)) return [];

    const file = this.deps.getFile(context.fileId);
    if (!file) return [];

    const modelContent = this.deps.getModelContent();
    if (!modelContent) return [];

    // Resolve symbol at cursor position via backend
    const symbol = await resolveSymbolAtPosition(
      { line: context.position.lineNumber, column: context.position.column },
      file,
      modelContent
    );
    if (!symbol) return [];

    // Inject symbol context variables into EDITOR_INSTANCE scope for when-expression evaluation
    const contextChain = getContextChain();
    const symbolContext = this.deps.contextValueFlatten("symbol", {
      kind: symbol.kind,
      name: symbol.name,
      detail: symbol.detail
    });
    contextChain.update(this.deps.scopeId, {
      symbolKind: symbol.kind,
      symbolDetail: symbol.detail ?? "",
      symbolName: symbol.name,
      ...symbolContext
    });

    // Evaluate which actions match the current context
    const actions = getSymbolActionRegistry().getSymbolActions();
    const contextValues = getCommandContextValues();
    const matchingActions = actions.filter(action =>
      evaluateWhenExpression(action.when, contextValues)
    );

    // Clear symbol context immediately — it was only needed for evaluation
    contextChain.update(this.deps.scopeId, {
      symbolKind: undefined,
      symbolDetail: undefined,
      symbolName: undefined
    });
    // Clear flattened keys too
    const clearedSymbol = this.deps.contextValueFlatten("symbol", {
      kind: undefined,
      name: undefined,
      detail: undefined
    });
    for (const key of Object.keys(clearedSymbol)) {
      contextChain.update(this.deps.scopeId, { [key]: undefined });
    }

    // Return matching actions as context menu items
    return matchingActions.map(action => ({
      id: `symbol-${action.id}`,
      label: action.label,
      order: action.order,
      run: () => this.executeAction(action, symbol, context.fileId!)
    }));
  }

  private async executeAction(action: SymbolAction, symbol: SymbolAtPositionResult, fileId: string): Promise<void> {
    const query = interpolateQuery(action.query, symbol);
    await this.deps.executeQuery(fileId, query, action.outputId);
  }
}

function interpolateQuery(template: string, symbol: SymbolAtPositionResult): string {
  return template
    .replace(/\$\{symbol\.name\}/g, symbol.name)
    .replace(/\$\{symbol\.kind\}/g, symbol.kind)
    .replace(/\$\{symbol\.detail\}/g, symbol.detail ?? "");
  // Unknown ${...} patterns are left as-is for forward compatibility.
}
```

### 5.4 `src/plugins/core.queryengine/symbol-action-invoke.ts` (NEW)

Frontend invoke helper for `sql.symbolAtPosition`. Mirrors the `sql-completion-language.ts` pattern.

```ts
import { getQueryEngineService } from "./QueryEngineService";
import type { SymbolAtPositionInvokePayload } from "../../contracts/backend/Types";
import type { SymbolAtPositionResult } from "./symbol-action-types";

/**
 * Resolves the symbol at a given cursor position by invoking the backend.
 * Returns null if the backend is unavailable or no symbol is found.
 * Uses the same resolution pattern as sql-completion-language.ts:
 *   1. Find the file for the current Monaco model URI
 *   2. Resolve the engine ID from the file's engine binding or MIME type
 *   3. Invoke the backend with action "sql.symbolAtPosition"
 */
export async function resolveSymbolAtPosition(
  position: { line: number; column: number },
  file: FileEntity,
  modelContent: string
): Promise<SymbolAtPositionResult | null> {
  const engineId = resolveEngineId(file);
  if (!engineId) return null;

  const payload: SymbolAtPositionInvokePayload = {
    fileId: file.fileId,
    text: modelContent,
    cursor: { line: position.line, column: position.column },
    connectionId: file.engineBinding?.connectionId,
    database: typeof file.metadata?.["core.queryengine.jdbc.database"] === "string"
      ? String(file.metadata["core.queryengine.jdbc.database"])
      : undefined
  };

  try {
    const result = await getQueryEngineService().invoke(
      { engineId, fileId: file.fileId, action: "sql.symbolAtPosition", payload },
      { silent: true }
    ) as SymbolAtPositionResult | null;

    return result;
  } catch {
    return null;
  }
}

function resolveEngineId(file: FileEntity): string | null {
  // Same resolution logic as sql-completion-language.ts:
  // 1. Use file.engineBinding.engineId if present
  // 2. Fall back to MIME type → engine resolution
  if (file.engineBinding?.engineId) {
    return file.engineBinding.engineId;
  }
  // MIME type based resolution via QueryEngineService
  const service = getQueryEngineService();
  const resolved = service.resolveEngineId(file.mimeType);
  return resolved ?? null;
}
```

### 5.5 `src/plugins/core.queryengine/symbol-action-settings.tsx` (NEW)

Advanced settings renderer for symbol actions CRUD editing. Follows the same pattern as `JdbcConnectionsSettingsEditor.tsx`.

**Features:**

- Uses `CollectionSettingsListEditor` for add/edit/delete/reorder of actions.
- Each action row shows: drag handle | label | when expression (truncated) | query (truncated).
- Detail panel fields:
  - **ID** (text, required, unique) — shown as read-only after creation.
  - **Label** (text, required) — display text in context menu.
  - **When Expression** — uses `WhenExpressionEditor` component for editing with autocomplete. The `WhenExpressionEditor` already exists in `core.commands` and supports context variable completion, including `symbol.kind`, `symbol.detail`, `symbol.name`.
  - **Query Template** (textarea, required) — the query text with `${symbol.name}`, `${symbol.kind}`, `${symbol.detail}` interpolation.
  - **Output ID** (dropdown) — selects from registered `OutputContributor` IDs. Leave empty for default primary output.
  - **Order** (number, optional) — sort priority.
- Persists via the settings system as JSON.
- On change, calls `getSymbolActionRegistry().setActions()` to update the runtime registry.

### 5.6 `src/plugins/core.queryengine/plugin.tsx` (MODIFY)

Register the `ContextMenuProvider` and settings:

```ts
// In activate(context):

// Register when-expression variables for autocomplete
registerWhenExpressionVariables([
  { name: "symbol.kind", type: "string", description: "Kind of symbol at cursor position (e.g. 'table', 'view', 'function')" },
  { name: "symbol.detail", type: "string", description: "Detail of symbol at cursor position (e.g. 'TABLE', 'VIEW')" },
  { name: "symbol.name", type: "string", description: "Name of symbol at cursor position (e.g. 'dbo.MyTable')" },
]);

// Register context menu provider
const symbolActionProvider = new SymbolActionProvider({
  getFile: (fileId) => context.files.getFile(fileId),
  getModelContent: () => getTextEditorRegistry()?.getActiveEditor()?.getContent() ?? undefined,
  isQueryRunning: (fileId) => {
    const file = context.files.getFile(fileId);
    return file?.metadata?.["core.queryengine.tabState"] === "running";
  },
  executeQuery: (fileId, query, outputId) => executeSymbolActionQuery(fileId, query, outputId),
  scopeId: getTextEditorRegistry()?.getScopeId() ?? "",
  contextValueFlatten: flattenContextObject
});
context.contextMenu.registerProvider(symbolActionProvider);

// When the editor registry is ready, update the provider's scope ID
// (This happens similarly to how sql-completion-language.ts wires up)

// Register settings
context.settings.registerSettings({
  moduleId: "core.queryengine",
  title: "Query Engine",
  settings: [
    // ... existing settings ...
    {
      id: SYMBOL_ACTIONS_SETTING_ID,
      moduleId: "core.queryengine",
      title: "Symbol Actions",
      description: "Configure context menu actions that appear when right-clicking on symbols (tables, views, functions) in SQL editors.",
      sectionPath: ["Query Engine", "Symbol Actions"],
      type: "json",
      defaultValue: [],
      advanced: {
        rendererId: SYMBOL_ACTIONS_SETTING_ID
      }
    }
  ]
});

context.settings.registerAdvancedRenderer({
  id: SYMBOL_ACTIONS_SETTING_ID,
  render: SymbolActionsSettingsEditor
});

// Sync settings to runtime registry
const settingsSubscription = context.settings.onDidChangeSetting?.(SYMBOL_ACTIONS_SETTING_ID, (value) => {
  getSymbolActionRegistry().setActions(value as SymbolAction[] ?? []);
});

// Initialize registry from current settings
const currentActions = context.settings.getSetting?.(SYMBOL_ACTIONS_SETTING_ID);
if (currentActions) {
  getSymbolActionRegistry().setActions(currentActions as SymbolAction[]);
}
```

---

## 6. When-Expression Context Variables

### Existing context variables (already available, no changes needed)

| Variable | Type | Source | Example |
|----------|------|--------|---------|
| `activeFile.mimeType` | string | Bootstrap scope | `"application/sql"` |
| `activeFile.metadata.core.queryengine.jdbc.dialectId` | string | ACTIVE_FILE scope (from metadata) | `"sqlserver"` |
| `activeFile.metadata.core.queryengine.jdbc.database` | string | ACTIVE_FILE scope (from metadata) | `"master"` |
| `activeFile.metadata.core.queryengine.jdbc.connectionTitle` | string | ACTIVE_FILE scope (from metadata) | `"Prod DB"` |
| `hasActiveFile` | boolean | Bootstrap scope | `true` |
| `hasActiveQueryExecutableFile` | boolean | Bootstrap scope | `true` |
| `editorFocus` | boolean | EDITOR_INSTANCE scope | `true` |
| `languageId` | string | EDITOR_INSTANCE scope | `"sql"` |

### New context variables (injected at right-click time into EDITOR_INSTANCE scope, cleared after evaluation)

| Variable | Type | Source | Example |
|----------|------|--------|---------|
| `symbol.kind` | string | Backend `sql.symbolAtPosition` result | `"table"` |
| `symbol.detail` | string | Backend result `detail` field | `"TABLE"` |
| `symbol.name` | string | Backend result `name` field | `"dbo.MyTable"` |

These are injected by `SymbolActionProvider` as structured context (`symbol.kind`, `symbol.name`, `symbol.detail`) during evaluation.

### When-expression examples

```sql
-- SQL Server: Describe a table
activeFile.mimeType == 'application/sql' && activeFile.metadata.core.queryengine.jdbc.dialectId == 'sqlserver' && symbol.kind == 'table'

-- PostgreSQL: Show table DDL
activeFile.mimeType == 'application/sql' && activeFile.metadata.core.queryengine.jdbc.dialectId == 'postgres' && symbol.kind == 'table'

-- Any SQL: Show object definition (not for columns)
activeFile.mimeType == 'application/sql' && symbol.kind != 'column'

-- SQL Server: Select top 100 from any table-like object
activeFile.mimeType == 'application/sql' && activeFile.metadata.core.queryengine.jdbc.dialectId == 'sqlserver' && symbol.kind.startsWith('table')
```

### Template examples

```sql
-- SQL Server: Describe table
exec sp_help ${symbol.name}

-- PostgreSQL: Show table definition
SELECT pg_get_tabledef(${symbol.name})

-- Generic: Select from table
SELECT * FROM ${symbol.name}

-- Multi-line query
-- Object: ${symbol.name} (kind: ${symbol.kind})
SELECT * FROM ${symbol.name}
WHERE 1=1
```

Unknown placeholders like `${symbol.schema}` are left as-is in V1, providing forward compatibility with future `SymbolAtPositionResult` fields.

---

## 7. Template Interpolation

```ts
/**
 * Interpolates symbol action query templates.
 * Replaces ${symbol.name}, ${symbol.kind}, ${symbol.detail} with values from the
 * SymbolAtPositionResult. Unknown placeholders are left as-is for forward compatibility.
 *
 * Future: this function can be replaced with a more advanced template engine
 * (e.g., Handlebars, Nunjucks) that supports conditionals and loops, as long as
 * the ${variable} interpolation syntax is preserved. Control flow syntax would use
 * a different delimiter pair (e.g., {% if %}...{% endif %}).
 */
function interpolateQuery(template: string, symbol: SymbolAtPositionResult): string {
  return template
    .replace(/\$\{symbol\.name\}/g, symbol.name)
    .replace(/\$\{symbol\.kind\}/g, symbol.kind)
    .replace(/\$\{symbol\.detail\}/g, symbol.detail ?? "");
  // Deliberately NOT replacing ${symbol.unknownField} — left as-is.
  // This ensures forward compatibility when SymbolAtPositionResult gains new fields
  // and templates reference them before the backend returns them.
}
```

---

## 8. Backend Contract (separate task)

The backend needs a new invoke action `sql.symbolAtPosition` for SQL engines. This is specified here for contract completeness but implemented separately.

### Request

```java
// Action: "sql.symbolAtPosition"
// Routed through existing EngineInvokeService.invoke()
SymbolAtPositionInvokePayload:
  - fileId?: String       // optional, for context resolution
  - text?: String          // optional, full document text (sent if fileId unavailable)
  - cursor: { line: int, column: int }  // 1-based line and column
  - connectionId?: String // for connection-scoped resolution
  - database?: String     // for database-scoped resolution
```

### Response

```java
SymbolAtPositionInvokeResult:
  - kind: String           // Engine-specific: "table", "view", "column", "function", "schema", etc.
  - name: String           // Fully qualified: "dbo.MyTable"
  - detail?: String        // Additional context: "TABLE", "VIEW"
  - range?: TextRange      // Document range of the symbol
```

### Backend implementation notes

- Uses `SqlParseContext` (renamed from `SqlCompletionContext`) and TreeSitter to resolve the node at the cursor position.
- The `SqlContextDetector` already classifies context (TABLE_REFERENCE vs OTHER). Extending this to return a `kind` and extracting the symbol name from the node is the core change.
- Should be added to the engine's `capabilities` response as `"sql.symbolAtPosition"`.

### Renaming: SqlCompletionContext → SqlParseContext (completed)

The existing `SqlCompletionContext` class has been renamed to `SqlParseContext` to reflect that it serves both completion and symbol navigation.

---

## 9. Query Running Guard

Before injecting symbol actions into the context menu, the `SymbolActionProvider` checks whether a query is already running on the active file. If so, it returns an empty items array.

The check is based on the existing file metadata convention:

```ts
const isQueryRunning = (fileId: string): boolean => {
  const file = filesRegistry.getFile(fileId);
  return file?.metadata?.["core.queryengine.tabState"] === "running";
};
```

This follows the same pattern used for command enablement in `core.queryengine`.

---

## 10. Settings UI Specification

### Location

Query Engine > Symbol Actions

### Setting definition

```ts
{
  id: "core.queryengine.symbolActions",
  moduleId: "core.queryengine",
  title: "Symbol Actions",
  description: "Context menu actions that appear when right-clicking on symbols (tables, views, functions) in SQL editors.",
  sectionPath: ["Query Engine", "Symbol Actions"],
  type: "json",
  defaultValue: [],
  advanced: {
    rendererId: "core.queryengine.symbolActions"
  }
}
```

### Advanced Renderer: `SymbolActionsSettingsEditor`

Follows the `CollectionSettingsListEditor` pattern from `JdbcConnectionsSettingsEditor.tsx`.

**List panel** (left side):
- Each row shows: drag handle | label | when expression (truncated) | query (truncated)
- Add button creates a new action with generated ID.
- Delete button removes the selected action.

**Detail panel** (right side):

| Field | Type | Description |
|-------|------|-------------|
| ID | text (read-only after creation) | Unique identifier, e.g. `describe-table-sqlserver` |
| Label | text (required) | Context menu display text, e.g. `Describe` |
| When Expression | WhenExpressionEditor (required) | When-expression with autocomplete for context variables including `symbol.kind`, `symbol.detail`, `symbol.name` |
| Query Template | textarea (required) | SQL query template with `${symbol.name}`, `${symbol.kind}`, `${symbol.detail}` interpolation |
| Output | dropdown (optional) | Select from registered `OutputContributor` IDs. Leave empty for default primary output. |
| Order | number (optional) | Sort order in context menu. Lower = higher. |

**Persistence**: uses `useCollectionSettingsPersistence` hook (same as JDBC connections) for debounced write-back to settings. On change, also calls `getSymbolActionRegistry().setActions()` to update the runtime registry.

**Validation**:
- ID must be unique and non-empty.
- Label must be non-empty.
- When expression must be syntactically valid (evaluate without error on empty context).
- Query template must be non-empty.

### WhenExpressionEditor integration

The existing `WhenExpressionEditor` component is used for the when-expression field. It provides:
- Monaco inline editor with `contextmenu: false`
- Autocomplete for context variables (including newly registered `symbol.kind`, `symbol.detail`, `symbol.name`)
- String method autocomplete (`.contains()`, `.startsWith()`, `.endsWith()`, `.matches()`, `.lower()`, `.upper()`)

---

## 11. Implementation Order

| Step | Description | Module | Files |
|------|-------------|--------|-------|
| 1 | Contract types | contracts | `ContextMenuExtension.ts`, modify `EditorApi.ts`, `Plugin.ts`, `backend/Types.ts` |
| 2 | ExtensionRegistry factory | core/plugin-runtime | `ExtensionRegistry.ts`, `PluginHost.ts` |
| 3 | TextEditorApi onContextMenu | core.editor/texteditor | `TextEditorApi.ts`, `MonacoTextEditorApi.ts` |
| 4 | Context menu coordination | core.editor/texteditor | `TextEditorComponent.tsx` — collect providers, inject Monaco actions |
| 5 | Registry accessor | core.editor/texteditor | Module-level `getContextMenuProviders()` (similar to `getQueryEngineService()`) |
| 6 | Symbol action types | core.queryengine | `symbol-action-types.ts` |
| 7 | Symbol action registry | core.queryengine | `symbol-action-registry.ts` |
| 8 | Symbol action invoke helper | core.queryengine | `symbol-action-invoke.ts` |
| 9 | Symbol action provider | core.queryengine | `symbol-action-provider.ts` — implement `ContextMenuProvider` |
| 10 | When-expression variables | core.queryengine | `plugin.tsx` — register `symbol.*` variables |
| 11 | Plugin wiring | core.queryengine | `plugin.tsx` — register `ContextMenuProvider`, settings, advanced renderer |
| 12 | Settings UI | core.queryengine | `symbol-action-settings.tsx` |
| 13 | Unit tests | both | Context menu coordination, provider, interpolation, registry, settings persistence |
| 14 | Integration testing | both | Right-click on SQL symbol → see actions in menu → click action → query executes |

---

## 12. New Files Summary

| File | Module | Purpose |
|------|--------|---------|
| `contracts/extensions/ContextMenuExtension.ts` | contracts | `ContextMenuProvider`, `ContextMenuItem`, `ContextMenuContext`, `ContextMenuRegistry` types |
| `plugins/core.queryengine/symbol-action-types.ts` | core.queryengine | `SymbolAction`, `SymbolAtPositionResult`, `SYMBOL_ACTIONS_SETTING_ID` |
| `plugins/core.queryengine/symbol-action-registry.ts` | core.queryengine | Module-level singleton registry for symbol actions |
| `plugins/core.queryengine/symbol-action-provider.ts` | core.queryengine | `SymbolActionProvider` implementing `ContextMenuProvider` |
| `plugins/core.queryengine/symbol-action-invoke.ts` | core.queryengine | Frontend invoke helper for `sql.symbolAtPosition` backend action |
| `plugins/core.queryengine/symbol-action-settings.tsx` | core.queryengine | Advanced settings renderer for CRUD editing of symbol actions |

## 13. Modified Files Summary

| File | Module | Change |
|------|--------|--------|
| `contracts/editor/EditorApi.ts` | contracts | Add `EditorContextMenuEvent` type |
| `contracts/plugin/Plugin.ts` | contracts | Add `contextMenu: ContextMenuRegistry` to `PluginContext` |
| `contracts/backend/Types.ts` | contracts | Add `SymbolAtPositionInvokePayload` |
| `plugins/core.editor/texteditor/TextEditorApi.ts` | core.editor | Add `abstract onContextMenu()` |
| `plugins/core.editor/texteditor/MonacoTextEditorApi.ts` | core.editor | Implement `onContextMenu()` |
| `plugins/core.editor/texteditor/TextEditorComponent.tsx` | core.editor | Wire context menu coordination: collect providers, inject Monaco actions, dispose on next right-click |
| `core/plugin-runtime/ExtensionRegistry.ts` | core/plugin-runtime | Add `createContextMenuRegistry()`, `getContextMenuProviders()` |
| `core/plugin-runtime/PluginHost.ts` | core/plugin-runtime | Wire `contextMenu` into plugin context |
| `plugins/core.queryengine/plugin.tsx` | core.queryengine | Register `ContextMenuProvider`, settings contributor, advanced renderer, when-expression variables |

## 14. Backend Changes (separate task)

| File | Change |
|------|--------|
| `SqlCompletionContext.java` | Rename to `SqlParseContext.java` |
| `SqlCompletionSupport.java` | Update references to `SqlParseContext` |
| New: `SqlSymbolAtPositionHandler.java` | Backend invoke handler for `sql.symbolAtPosition` action |
| Engine capabilities | Add `"sql.symbolAtPosition"` to supported actions |

---

## 15. Phase 2 — Deferred Features

### Monaco DefinitionProvider Bridge

Register a Monaco `DefinitionProvider` for SQL languages that delegates to `sql.symbolAtPosition`:

- Ctrl+Click / F12 navigates to the symbol's definition location (if `range` is returned).
- Requires backend to return a `definitionLocation` (URI + range) in addition to kind/name/detail.
- Uses the same `ContextMenuRegistry` pattern? No — DefinitionProvider is a separate Monaco language feature registration, not a context menu concern. Would need a new `DefinitionProviderRegistry` on `PluginContext`.

### Monaco HoverProvider Bridge

Register a Monaco `HoverProvider` that shows available symbol actions as hover content:

- Tooltip shows action labels and keyboard shortcuts.
- Requires a separate registration mechanism (similar to outline providers).

### Advanced Template Engine

Replace the simple `${...}` interpolation with a more capable engine:

- Use `${...}` for interpolation (preserved).
- Use `{% if %}...{% endif %}` for conditionals (new delimiter pair).
- Enables templates like: `{% if symbol.kind == 'table' %}exec sp_help ${symbol.name}{% elif symbol.kind == 'view' %}sp_helptext ${symbol.name}{% endif %}`.

### Plugin-contributed Symbol Actions

The current design puts all actions in settings. A future phase could allow plugins to register default actions via `context.contextMenu.registerProvider()` with a `ContextMenuProvider` that reads from a plugin-provided list. This requires no architectural change — just a new provider implementation.
