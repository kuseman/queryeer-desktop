import type { JdbcTreeNode } from "./jdbc-navigation-types";
import type { JdbcTreeContextMenuContribution, JdbcTreeContextMenuRegistry } from "./jdbc-tree-context-menu-types";
import type { TreeAction } from "./tree-action-types";
import { getTreeActionRegistry } from "./tree-action-registry";
import { getCommandContext } from "../core.commands/command-context-accessor";
import { getExpressionRuntime } from "../core.expressions/runtime";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { addFrontendLogEntry } from "../core.panel.console/console-state";

type TreeActionProviderDeps = {
  treeContextMenu: JdbcTreeContextMenuRegistry;
  createUntitledFile: (options: { mimeType: string; extension: string; title?: string }) => Promise<{ fileId: string }>;
  applyRecoveredContent: (fileId: string, content: string) => void;
  setFileEngineBinding: (fileId: string, connectionId: string, database: string | undefined) => void;
  getActiveFileId: () => string | null;
};

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatResultSetAsText(resultSet: { schema: { columns: { name: string }[] }; rows: unknown[][] }): string {
  if (resultSet.rows.length === 0) {
    return "(0 rows)";
  }
  const colWidths = resultSet.schema.columns.map((col, i) => {
    const maxDataWidth = Math.max(0, ...resultSet.rows.slice(0, 100).map((row) => formatCellValue(row[i]).length));
    return Math.max(col.name.length, maxDataWidth);
  });
  const dataRows = resultSet.rows.slice(0, 1000).map((row) =>
    row.map((val, i) => formatCellValue(val).padEnd(colWidths[i])).join(" | ")
  );
  const overflow = resultSet.rows.length > 1000 ? `\n... (${resultSet.rows.length - 1000} more rows truncated)` : "";
  return dataRows.join("\n") + overflow;
}

export function createTreeActionProvider(deps: TreeActionProviderDeps): void {
  const treeContextMenu = deps.treeContextMenu;
  const registeredActionIds: string[] = [];

  function resolveDatabase(node: JdbcTreeNode): string | undefined {
    return node.kind === "database"
      ? node.name
      : typeof node.attributes.catalog === "string"
        ? node.attributes.catalog
        : undefined;
  }

  function buildEngineState(node: JdbcTreeNode): Record<string, unknown> {
    const engineState: Record<string, unknown> = { connectionId: node.connectionId };
    const database = resolveDatabase(node);
    if (database) {
      engineState.database = database;
    }
    return engineState;
  }

  async function executeAction(action: TreeAction, node: JdbcTreeNode): Promise<void> {
    const runtime = getExpressionRuntime();
    const mergedContext = getCommandContext();

    try {
      const rendered = await runtime.renderTemplate(action.query, mergedContext, {
        mode: "template",
        source: `tree-action:${action.id}:query`,
      });

      if (action.mode === "render") {
        if (action.outputTarget === "clipboard") {
          await navigator.clipboard.writeText(rendered);
          return;
        }
        if (action.outputTarget === "newQuery" || action.outputTarget === "output") {
          const file = await deps.createUntitledFile({
            mimeType: "application/sql",
            extension: "sql",
            title: action.label.replace(/[<>:"/\\|?*]/g, "_").slice(0, 100)
          });
          deps.applyRecoveredContent(file.fileId, rendered);
          return;
        }
        return;
      }

      const engineState = buildEngineState(node);
      const database = resolveDatabase(node);

      if (action.outputTarget === "clipboard") {
        const { resultSets } = await getQueryEngineService().executeAndCollect({
          engineId: "jdbc",
          fileId: crypto.randomUUID(),
          text: rendered,
          engineState,
        });
        await navigator.clipboard.writeText(resultSets.map(formatResultSetAsText).join("\n\n"));
        return;
      }

      if (action.outputTarget === "newQuery") {
        const { resultSets } = await getQueryEngineService().executeAndCollect({
          engineId: "jdbc",
          fileId: crypto.randomUUID(),
          text: rendered,
          engineState,
        });
        const combinedText = resultSets.map(formatResultSetAsText).join("\n\n");
        const file = await deps.createUntitledFile({
          mimeType: "application/sql",
          extension: "sql",
          title: `${action.label.replace(/[<>:"/\\|?*]/g, "_").slice(0, 100)} - Result`
        });
        deps.applyRecoveredContent(file.fileId, combinedText);
        deps.setFileEngineBinding(file.fileId, node.connectionId, database);
        return;
      }

      if (action.outputTarget === "output") {
        const activeFileId = deps.getActiveFileId();
        if (!activeFileId) return;
        deps.applyRecoveredContent(activeFileId, rendered);
        deps.setFileEngineBinding(activeFileId, node.connectionId, database);
        getQueryEngineService().requestExecute({ textOverride: rendered, outputIdOverride: action.outputId, formatOverride: "plain" });
        return;
      }
    } catch (error) {
      addFrontendLogEntry("error", "TreeActionProvider", `Execution failed for '${action.id}': ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function registerActions(actions: TreeAction[]): void {
    for (const action of actions) {
      const contribution: JdbcTreeContextMenuContribution = {
        id: `tree-action-${action.id}`,
        label: action.label,
        order: action.order ?? 100,
        section: "tree-actions",
        matches: (_node: JdbcTreeNode) => {
          const expr = action.when?.trim();
          if (!expr) return true;
          try {
            const runtime = getExpressionRuntime();
            return runtime.evaluateBooleanSync(expr, getCommandContext(), {
              mode: "when",
              source: `tree-action:${action.id}:when`,
            });
          } catch {
            return false;
          }
        },
        run: async (node: JdbcTreeNode) => {
          await executeAction(action, node);
        }
      };
      treeContextMenu.registerContribution(contribution);
      registeredActionIds.push(action.id);
    }
  }

  function unregisterAll(): void {
    for (const id of registeredActionIds) {
      treeContextMenu.unregisterContribution(`tree-action-${id}`);
    }
    registeredActionIds.length = 0;
  }

  const initialActions = getTreeActionRegistry().getActions();
  registerActions(initialActions);

  getTreeActionRegistry().onDidChangeActions(() => {
    unregisterAll();
    const currentActions = getTreeActionRegistry().getActions();
    registerActions(currentActions);
  });
}
