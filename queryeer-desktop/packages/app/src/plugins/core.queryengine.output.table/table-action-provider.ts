import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import type {
  TableOutputContextMenuContext,
  TableOutputContextMenuItem,
  TableOutputContextMenuProvider,
} from "@queryeer/api/queryengine/TableOutputContextMenuExtension";
import type { TableAction, TableActionData } from "./table-action-types";
import { getTableActionRegistry } from "./table-action-registry";
import { getCommandContext } from "../core.commands/command-context-accessor";
import { getExpressionRuntime } from "../core.expressions/runtime";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getEditorRegistryHost } from "../../core/plugin-runtime/ExtensionRegistry";
import { addFrontendLogEntry } from "../core.panel.console/console-state";

export function buildTableActionData(ctx: TableOutputContextMenuContext): TableActionData {
  const { columns, selection } = ctx;
  const rows: Record<string, unknown>[] = [];
  const fullRowData = ctx.cellValuesByRow ?? {};
  for (const ri of selection.selectedRowIndexes) {
    const row: Record<string, unknown> = {};
    const cellValues = fullRowData[ri];
    if (cellValues && Array.isArray(cellValues)) {
      for (let ci = 0; ci < columns.length; ci++) {
        row[columns[ci].name] = ci < cellValues.length ? cellValues[ci] : null;
      }
    } else {
      // Fallback: only populate selected cells
      for (let ci = 0; ci < columns.length; ci++) {
        const cell = selection.selectedCells.find((c) => c.rowIndex === ri && c.columnIndex === ci);
        row[columns[ci].name] = cell?.value ?? null;
      }
    }
    rows.push(row);
  }
  return {
    rows,
    columns,
    primaryRowIndex: 0,
    selectedRowIndexes: selection.selectedRowIndexes.slice(),
    selectedColumnIndexes: selection.selectedColumnIndexes.slice(),
  };
}

export function createTableActionProvider(context: PluginContext): TableOutputContextMenuProvider {
  return {
    id: "core.queryengine.output.table.tableActions",

    async getItems(ctx: TableOutputContextMenuContext): Promise<TableOutputContextMenuItem[]> {
      const actions = getTableActionRegistry().getActions();
      if (actions.length === 0) return [];

      const runtime = getExpressionRuntime();
      const baseContext = getCommandContext();
      let tableData: TableActionData;
      try {
        tableData = buildTableActionData(ctx);
      } catch (error) {
        addFrontendLogEntry("error", "TableActionProvider", `Failed to build table data: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }

      const mergedContext = {
        ...baseContext,
        tableData,
        tableSelection: {
          hasSelection: ctx.selection.hasSelection,
          selectedCellCount: ctx.selection.selectedCells.length,
          selectedRowCount: ctx.selection.selectedRowIndexes.length,
          selectedColumnCount: ctx.selection.selectedColumnIndexes.length,
          isSingleColumnSelection: ctx.selection.isSingleColumnSelection,
          isSingleRowSelection: ctx.selection.isSingleRowSelection,
          columns: ctx.columns,
          columnNames: ctx.columns.map((c) => c.name),
        },
      };

      const matching: TableAction[] = [];
      for (const action of actions) {
        const expr = action.when?.trim();
        if (!expr) {
          matching.push(action);
          continue;
        }
        try {
          const visible = await runtime.evaluateBoolean(expr, mergedContext, {
            mode: "when",
            source: `table-action:${action.id}:when`,
          });
          if (visible) matching.push(action);
        } catch (error) {
          addFrontendLogEntry("error", "TableActionProvider", `When expression evaluation failed for '${action.id}': ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (matching.length === 0) return [];

      const items: TableOutputContextMenuItem[] = [];
      for (const action of matching) {
        try {
          const label = await runtime.renderTemplate(action.label, mergedContext, {
            mode: "template",
            source: `table-action:${action.id}:label`,
          });
          items.push({
            id: `table-action-${action.id}`,
            label,
            order: action.order,
            run: () => {
              void executeTableAction(action, mergedContext, context, label);
            },
          });
        } catch (error) {
          addFrontendLogEntry("error", "TableActionProvider", `Label template render failed for '${action.id}': ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return items;
    },
  };
}

async function executeTableAction(
  action: TableAction,
  context: Record<string, unknown>,
  pluginContext: PluginContext,
  renderedLabel?: string
): Promise<void> {
  const runtime = getExpressionRuntime();

  try {
    const rendered = await runtime.renderTemplate(action.query, context, {
      mode: "template",
      source: `table-action:${action.id}:query`,
    });

    if (action.outputTarget === "output") {
      getQueryEngineService().requestExecute({ textOverride: rendered });
      return;
    }

    if (action.outputTarget === "clipboard") {
      await navigator.clipboard.writeText(rendered);
      return;
    }

    if (action.outputTarget === "newFileAndExecute") {
      const activeFile = (context as Record<string, unknown>).activeFile as { fileId?: string; mimeType?: string } | undefined;
      const mimeType = activeFile?.mimeType ?? "text/plain";
      const title = renderedLabel ? renderedLabel.replace(/[<>:"/\\|?*]/g, "_").slice(0, 100) : undefined;
      const file = await pluginContext.fileMediator.createUntitledFile({
        mimeType,
        title,
        cloneFromFileId: activeFile?.fileId ?? undefined,
      });
      getEditorRegistryHost().applyRecoveredContent(file.fileId, rendered);
      // Defer execution to give React time to mount the new tab's component.
      // The mount-time check and peekExecuteOptions guard ensure the request
      // targets the correct file.
      setTimeout(() => {
        getQueryEngineService().requestExecute({ textOverride: rendered, fileIdOverride: file.fileId });
      }, 0);
      return;
    }

    if (action.outputTarget === "newFile") {
      const activeFile = (context as Record<string, unknown>).activeFile as { fileId?: string; mimeType?: string } | undefined;
      const mimeType = activeFile?.mimeType ?? "text/plain";
      const title = renderedLabel ? renderedLabel.replace(/[<>:"/\\|?*]/g, "_").slice(0, 100) : undefined;
      const file = await pluginContext.fileMediator.createUntitledFile({
        mimeType,
        title,
        cloneFromFileId: activeFile?.fileId ?? undefined,
      });
      getEditorRegistryHost().applyRecoveredContent(file.fileId, rendered);
      return;
    }
  } catch (error) {
    addFrontendLogEntry("error", "TableActionProvider", `Execution failed for '${action.id}': ${error instanceof Error ? error.message : String(error)}`);
  }
}
