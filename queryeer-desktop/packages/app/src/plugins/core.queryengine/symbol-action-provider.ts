import type { ContextMenuProvider, ContextMenuContext, ContextMenuItem } from "@queryeer/api/extensions/ContextMenuExtension";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { SymbolAction, SymbolAtPositionResult } from "./symbol-action-types";
import { resolveSymbolAtPosition } from "./symbol-action-invoke";
import { getSymbolActionRegistry } from "./symbol-action-registry";
import { getCommandContext } from "../core.commands/command-context-accessor";
import { getQueryEngineService } from "./QueryEngineService";
import { getExpressionRuntime } from "../core.expressions/runtime";

type SymbolActionProviderDeps = {
  getFile: (fileId: string) => FileEntity | undefined;
  getModelContent: (fileId: string, uri: string) => string | undefined;
  isQueryRunning: (fileId: string) => boolean;
  executeQuery: (fileId: string, query: string) => Promise<void>;
};

function createSymbolContext(symbol: SymbolAtPositionResult) {
  return {
    kind: symbol.kind,
    name: symbol.name,
    fullName: symbol.fullName ?? symbol.name,
    detail: symbol.detail ?? "",
    attributes: symbol.attributes ?? {}
  };
}

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
    const symbolContext = {
      symbol: createSymbolContext(symbol)
    };
    const mergedContext = { ...baseContext, ...symbolContext };

    const actions = getSymbolActionRegistry().getSymbolActions();
    const runtime = getExpressionRuntime();
    const matchingActions: SymbolAction[] = [];
    for (const action of actions) {
      const expr = action.when?.trim();
      if (!expr) {
        matchingActions.push(action);
        continue;
      }
      try {
        const visible = await runtime.evaluateBoolean(expr, mergedContext, {
          mode: "when",
          source: `symbol-action:${action.id}:when`,
        });
        if (visible) {
          matchingActions.push(action);
        }
      } catch {
        // Invalid expressions hide the action.
      }
    }

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
    const runtime = getExpressionRuntime();
    const query = await runtime.renderTemplate(action.query, {
      symbol: createSymbolContext(symbol)
    }, {
      mode: "template",
      source: `symbol-action:${action.id}:query`
    });
    await this.deps.executeQuery(fileId, query);
  }
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
