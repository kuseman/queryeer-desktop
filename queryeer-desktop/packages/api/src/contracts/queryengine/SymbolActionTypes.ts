import type { TextRange } from "../editor/EditorApi.js";
import type { SymbolAtPositionInvokeResult } from "../backend/Types.js";

export type SymbolAction = {
  id: string;
  label: string;
  when: string;
  query: string;
  outputId?: string;
  order?: number;
};

export type SymbolAtPositionResult = SymbolAtPositionInvokeResult & {
  range?: TextRange;
};

export const SYMBOL_ACTIONS_SETTING_ID = "core.queryengine.symbolActions";
