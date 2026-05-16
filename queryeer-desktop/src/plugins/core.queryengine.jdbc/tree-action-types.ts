export type TreeActionMode = "execute" | "render";
export type TreeActionOutputTarget = "output" | "clipboard" | "newQuery";

export type TreeAction = {
  id: string;
  label: string;
  /**
   * JS expression evaluated by ExpressionRuntime against the full context chain plus node.* variables:
   *   node.kind, node.name, node.fullName, node.nodeType, node.connectionId, node.attributes.*
   * plus all existing context variables (activeFile.mimeType, activeFile.metadata.*, etc.)
   */
  when: string;
  /** Query template evaluated by ExpressionRuntime template interpolation (${...}). */
  query: string;
  mode: TreeActionMode;
  outputTarget: TreeActionOutputTarget;
  /** When mode='execute' and outputTarget='output', route to this specific output contributor. */
  outputId?: string;
  order?: number;
};

export const TREE_ACTIONS_SETTING_ID = "core.queryengine.jdbc.treeActions";
