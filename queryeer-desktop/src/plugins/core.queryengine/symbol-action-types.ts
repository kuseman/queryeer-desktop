import type { TextRange } from "../../contracts/editor/EditorApi";

export type SymbolAction = {
  id: string;
  label: string;
  /**
   * When-expression evaluated against the full context chain plus symbol.* variables:
   *   symbol.kind, symbol.name, symbol.detail
   * plus all existing context variables (activeFileMimetype, activeFileMetadata.*, etc.)
   */
  when: string;
  /** Query template. Supports ${symbol.name}, ${symbol.kind}, ${symbol.detail}. Unknown placeholders are left as-is. */
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
