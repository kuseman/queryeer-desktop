# Table Actions — Implementation Plan

## Overview

Add user-created queries that act upon table selection values, similar to Symbol Actions but for the table output context menu. Users define rules that add context menu items on right-click in the Ag-Grid table output.

**Owner**: `core.queryengine.output.table` (all files in this module)

---

## Files

### New (5)

All in `src/plugins/core.queryengine.output.table/`:

| File | Purpose |
|------|---------|
| `table-action-types.ts` | `TableAction`, `TableActionMode`, `TableActionOutputTarget`, `TableActionData`, `TABLE_ACTIONS_SETTING_ID` |
| `table-action-registry.ts` | Singleton registry (`setActions`, `getActions`, `onDidChangeActions`) |
| `table-action-template-registry.ts` | `registerTableActionTemplate`, `listTableActionTemplates`, `subscribeTableActionTemplates` |
| `table-action-provider.ts` | `TableOutputContextMenuProvider` — when-eval, template-render, execute dispatch |
| `table-action-settings.tsx` | Settings editor component (`TableActionsSettingsEditor`) |

### Modified (1)

`src/plugins/core.queryengine.output.table/plugin.tsx` — wire provider, settings, when-vars.

No changes to `core.queryengine/plugin.tsx` or `core.expressions/runtime.ts`.

---

## Types (`table-action-types.ts`)

```typescript
type TableActionMode = "execute" | "render";
type TableActionOutputTarget = "output" | "clipboard" | "newFile";

type TableAction = {
  id: string;
  /** Template for the context menu label — supports ${...} expressions */
  label: string;
  /** JS when-expression evaluated against table action context */
  when: string;
  /** Query/result template — supports ${...} expressions */
  query: string;
  /** Whether to execute the rendered query or treat the rendered text as the result */
  mode: TableActionMode;
  /** Where to send the result */
  outputTarget: TableActionOutputTarget;
  order?: number;
};

type TableActionData = {
  rows: Record<string, unknown>[];
  columns: { name: string; type: string }[];
  primaryRowIndex: number;
  selectedRowIndexes: number[];
  selectedColumnIndexes: number[];
};

const TABLE_ACTIONS_SETTING_ID = "core.queryengine.output.table.tableActions";
```

---

## Registry (`table-action-registry.ts`)

Singleton, same pattern as `SymbolActionRegistryImpl`:

```typescript
class TableActionRegistryImpl {
  getActions(): TableAction[] { ... }
  setActions(actions: TableAction[]): void { ... }
  onDidChangeActions(callback: () => void): Disposable { ... }
}
```

---

## Template Registry (`table-action-template-registry.ts`)

Same pattern as `symbol-action-template-registry.ts`:

```typescript
type TableActionTemplateContribution = {
  id: string;
  title: string;
  description?: string;
  action: Omit<TableAction, "id">;
  order?: number;
};
```

Plugins (JDBC, PayloadBuilder) can contribute default templates via `registerTableActionTemplate()`.

---

## Provider (`table-action-provider.ts`) — Core Logic

### Backend Expression Evaluation

Table actions are evaluated using the **existing backend expression pipeline** (`getExpressionRuntime().evaluateBoolean()` / `renderTemplate()`). This avoids CSP restrictions that block `new Function()` in the browser.

The evaluation context is a plain JSON-serializable object:

| Source | Context key | Example |
|--------|-------------|---------|
| `getCommandContext()` | Direct merge | `activeFile.mimeType`, `tableSelection.hasSelection` |
| Table selection data | `tableData` | `tableData.rows[0].correlationId`, `tableData.columns` |

**Important**: Namespace functions (`date.*`, `sql.*`) require the `fn.` prefix since evaluation runs in the backend:
- `${fn.sql.literal(value)}` not `${sql.literal(value)}`
- `${fn.date.add(value, "minute", -5)}` not `${date.add(value, "minute", -5)}`

**Table data is accessed directly via `tableData` context variable** (no `table.*` helper functions needed):
- `tableData.rows[rowIndex][columnName]`
- `tableData.primaryRowIndex`
- `tableData.columns` / `tableData.columns.some(c => c.name === '...')`

### Execution Dispatch

| mode | target | Behavior |
|------|--------|----------|
| any | `output` | Render query template → `requestExecute({ textOverride })` in current file (like Symbol Actions) |
| any | `clipboard` | Render query template → `navigator.clipboard.writeText()` |
| any | `newFile` | Render query template → `createUntitledFile()` → `broadcastContentUpdate()` with rendered content |

### Dependencies

The provider receives the full `PluginContext` from plugin activation:
- `context.fileMediator` — `createUntitledFile()`, `getActiveFileId()`
- `getQueryEngineService().requestExecute()` — for execute/output mode
- `getExpressionRuntime()` — for backend expression evaluation
- `getEditorRegistryHost()` — for setting file content

---

## Settings Editor (`table-action-settings.tsx`)

Reuses `CollectionSettingsListEditor`, `InlineMonacoEditor`, `WhenExpressionEditor` from existing settings UI.

Additional fields vs Symbol Actions:
- **Label** — uses `InlineMonacoEditor` (is a template with `${...}`)
- **Mode** — selector: "Execute query" / "Render template"
- **Output target** — selector: "Output panel" / "Clipboard" / "New file"
- **Template picker** — dropdown of registered templates from plugins

---

## Wiring (`plugin.tsx`)

```typescript
// 1. Register when-expression variables for autocomplete
registerWhenExpressionVariables([
  { name: "tableSelection.columns", type: "string", description: "..." },
  { name: "tableSelection.columnNames", type: "string", description: "..." },
  { name: "tableData", type: "string", description: "Full table selection data object" },
]);

// 2. Register context menu provider
context.tableOutputContextMenu.registerProvider(createTableActionProvider(context));

// 3. Register advanced settings renderer
context.settings.registerAdvancedRenderer({
  id: TABLE_ACTIONS_SETTING_ID,
  render: ({ value, setValue, readonly }) => <TableActionsSettingsEditor .../>
});

// 4. Register settings definition
context.settings.registerSettings({
  moduleId: "core.queryengine.output.table",
  title: "Query Engine Output Table",
  settings: [{
    id: TABLE_ACTIONS_SETTING_ID,
    title: "Table Actions",
    description: "Context menu actions on table selection values.",
    sectionPath: ["Query Engine", "Table Actions"],
    type: "json",
    defaultValue: [],
    advanced: { rendererId: TABLE_ACTIONS_SETTING_ID }
  }]
});

// 5. Extend resolveTableContextMenuItems context with column info
//    tableSelection.columns, tableSelection.columnNames

// 6. Sync from settings to registry on settings service init
onCoreSettingsServiceInitialized((service) => {
  service.subscribe(() => {
    const v = service.getValue(TABLE_ACTIONS_SETTING_ID);
    if (Array.isArray(v)) getTableActionRegistry().setActions(v);
  });
  service.refreshSchemaFromRegistry();
  const initial = service.getValue(TABLE_ACTIONS_SETTING_ID);
  if (Array.isArray(initial)) getTableActionRegistry().setActions(initial);
  void service.syncRegistryModules();
});
```

---

## Example Usage

```sql
action: Correlated documents of ${tableData.rows[tableData.primaryRowIndex].correlationId}
when: activeFile.mimeType == 'application/plbsql' && tableData.columns.some(c => c.name == 'correlationId') && tableData.columns.some(c => c.name == '@timestamp')
mode: execute
target: output
query:
  SELECT * FROM _doc
  WHERE correlationId = '${fn.sql.literal(tableData.rows[tableData.primaryRowIndex].correlationId)}'
  AND "@timestamp" >= '${fn.date.add(tableData.rows[tableData.primaryRowIndex]["@timestamp"], "minute", -5)}'
```

User flow:
1. Runs a PayloadBuilder query → table output shows results
2. Selects a row with `correlationId` and `@timestamp` columns
3. Right-clicks → sees `Correlated documents of abc-123` in the context menu (label template rendered)
4. Clicks → query template is rendered via backend runtime and executed via `requestExecute({ textOverride })`
5. Results appear in the output panel

---

## Implementation Order

1. `table-action-types.ts`
2. `table-action-registry.ts`
3. `table-action-template-registry.ts`
4. `table-action-provider.ts`
5. `table-action-settings.tsx`
6. `plugin.tsx` — wire everything
