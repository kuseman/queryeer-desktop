import type { Disposable } from "../editor/EditorApi.js";
import type { SymbolAction } from "./SymbolActionTypes.js";

export type SymbolActionTemplateContribution = {
  id: string;
  title: string;
  description?: string;
  action: Omit<SymbolAction, "id">;
  order?: number;
};

/**
 * Templates for symbol actions: queries the user can run on a symbol in the editor, such as "Describe" on a table.
 * A template is offered in the Symbol Actions settings; the user creates an action from it.
 */
export type SymbolActionRegistry = {
  /** A later template with the same id replaces an earlier one. Disposing removes it, unless it was replaced. */
  registerTemplate: (template: SymbolActionTemplateContribution) => Disposable;
};
