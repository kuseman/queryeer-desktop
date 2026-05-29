import type { TextRange } from "../../contracts/editor/EditorApi";
import type { SymbolAtPositionInvokeResult } from "../../contracts/backend/Types";

export type SymbolAction = {
  id: string;
  label: string;
  /**
   * JS expression evaluated by ExpressionRuntime against the full context chain plus symbol.* variables:
   *   symbol.kind, symbol.name, symbol.fullName, symbol.detail, symbol.attributes.*
   * plus all existing context variables (activeFile.mimeType, activeFile.metadata.*, etc.)
   */
  when: string;
   /** Query template evaluated by ExpressionRuntime template interpolation (${...}). */
  query: string;
  outputId?: string;
  order?: number;
};

export type SymbolAtPositionResult = SymbolAtPositionInvokeResult & {
  range?: TextRange;
};

export const SYMBOL_ACTIONS_SETTING_ID = "core.queryengine.symbolActions";
