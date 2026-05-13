import type { ContextMenuProvider, ContextMenuContext, ContextMenuItem } from "../../contracts/extensions/ContextMenuExtension";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { SymbolAction, SymbolAtPositionResult } from "./symbol-action-types";
import { resolveSymbolAtPosition } from "./symbol-action-invoke";
import { getSymbolActionRegistry } from "./symbol-action-registry";
import { evaluateWhenExpression } from "../core.commands/when-evaluator";
import { getCommandContext } from "../core.commands/command-context-accessor";
import { flattenContextObject } from "../../renderer/shell/context-value-flatten";
import { getQueryEngineService } from "./QueryEngineService";

type SymbolActionProviderDeps = {
  getFile: (fileId: string) => FileEntity | undefined;
  getModelContent: (fileId: string, uri: string) => string | undefined;
  isQueryRunning: (fileId: string) => boolean;
  executeQuery: (fileId: string, query: string) => Promise<void>;
};

export class SymbolActionProvider implements ContextMenuProvider {
  readonly id = "core.queryengine.symbolActions";
  private deps: SymbolActionProviderDeps;

  constructor(deps: SymbolActionProviderDeps) {
    this.deps = deps;
  }

  async getItems(context: ContextMenuContext): Promise<ContextMenuItem[]> {
    if (!context.fileId || !context.mimeType) return [];
    if (this.deps.isQueryRunning(context.fileId)) return [];

    const file = this.deps.getFile(context.fileId);
    if (!file) return [];

    const modelContent = this.deps.getModelContent(context.fileId, file.uri);
    if (!modelContent) return [];

    const symbol = await resolveSymbolAtPosition(
      { line: context.position.lineNumber, column: context.position.column },
      file,
      modelContent
    );
    if (!symbol) return [];

    // Merge symbol variables into the effective context for when-expression evaluation.
    // This avoids mutating the context chain scope (which would wipe focus/language state).
    const baseContext = getCommandContext();
    const symbolContext = flattenContextObject("symbol", {
      kind: symbol.kind,
      name: symbol.name,
      detail: symbol.detail ?? ""
    });
    const mergedContext = { ...baseContext, ...symbolContext };

    const actions = getSymbolActionRegistry().getSymbolActions();
    const matchingActions = actions.filter((action) => {
      try {
        return evaluateWhenExpression(action.when, mergedContext);
      } catch {
        return false;
      }
    });

    return matchingActions.map((action) => ({
      id: `symbol-${action.id}`,
      label: action.label,
      order: action.order,
      run: () => {
        void this.executeAction(action, symbol, context.fileId!);
      }
    }));
  }

  private async executeAction(
    action: SymbolAction,
    symbol: SymbolAtPositionResult,
    fileId: string
  ): Promise<void> {
    const query = interpolateQuery(action.query, symbol);
    await this.deps.executeQuery(fileId, query);
  }
}

function interpolateQuery(template: string, symbol: SymbolAtPositionResult): string {
  return template
    .replace(/\$\{symbol\.name\}/g, symbol.name)
    .replace(/\$\{symbol\.kind\}/g, symbol.kind)
    .replace(/\$\{symbol\.detail\}/g, symbol.detail ?? "");
  // Unknown ${...} placeholders are intentionally left as-is for forward compatibility.
}

export function createSymbolActionProvider(
  filesRegistry: { getFile: (fileId: string) => FileEntity | undefined },
  editorRegistryHost: { resolveFileContent: (fileId: string, uri: string) => string | undefined }
): SymbolActionProvider {
  return new SymbolActionProvider({
    getFile: (fileId) => filesRegistry.getFile(fileId),
    getModelContent: (fileId, uri) => editorRegistryHost.resolveFileContent(fileId, uri),
    isQueryRunning: (fileId) => {
      const file = filesRegistry.getFile(fileId);
      return file?.metadata?.["core.queryengine.tabState"] === "running";
    },
    executeQuery: async (_fileId, query) => {
      getQueryEngineService().requestExecute({ textOverride: query });
    }
  });
}
