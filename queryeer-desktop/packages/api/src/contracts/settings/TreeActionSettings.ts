export type TreeActionMode = "execute" | "render";
export type TreeActionOutputTarget = "output" | "clipboard" | "newQuery" | "newQueryAndExecute";

export type TreeAction = {
  id: string;
  label: string;
  when: string;
  query: string;
  mode: TreeActionMode;
  outputTarget: TreeActionOutputTarget;
  outputId?: string;
  order?: number;
};

export const TREE_ACTIONS_SETTING_ID = "core.queryengine.jdbc.treeActions";
