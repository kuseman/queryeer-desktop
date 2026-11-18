import type { Disposable } from "../editor/EditorApi.js";
import type { TreeAction } from "./TreeActionSettings.js";

export type TreeActionTemplateContribution = {
  id: string;
  title: string;
  description?: string;
  action: Omit<TreeAction, "id">;
  order?: number;
};

/**
 * Templates for JDBC tree actions: queries the user can run on a node in the SQL Databases tree, such as "Select Top
 * 100 Rows" on a table. A template is offered in the Tree Actions settings; the user creates an action from it.
 */
export type JdbcTreeActionRegistry = {
  /** A later template with the same id replaces an earlier one. Disposing removes it, unless it was replaced. */
  registerTemplate: (template: TreeActionTemplateContribution) => Disposable;
};
