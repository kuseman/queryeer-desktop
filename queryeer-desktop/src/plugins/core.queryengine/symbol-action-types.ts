import type { TextRange } from "../../contracts/editor/EditorApi";

export type SymbolAction = {
  id: string;
  label: string;
  /**
   * JS expression evaluated by ExpressionRuntime against the full context chain plus symbol.* variables:
   *   symbol.kind, symbol.name, symbol.detail
   * plus all existing context variables (activeFile.mimeType, activeFile.metadata.*, etc.)
   */
  when: string;
   /** Query template evaluated by ExpressionRuntime template interpolation (${...}). */
  query: string;
  outputId?: string;
  order?: number;
};

export type SymbolAtPositionResult = {
  kind: string;
  name: string;
  detail?: string;
  range?: TextRange;
};

export const SYMBOL_ACTIONS_SETTING_ID = "core.queryengine.symbolActions";
