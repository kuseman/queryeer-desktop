import type { JdbcTreeNode } from "./JdbcNavigationTypes.js";

export type JdbcTreeNodeContributor = {
  dialectId: string;
  getIcon?: (kind: string, attributes: Record<string, unknown>) => string | undefined;
  enrichChildren?: (
    parentNode: JdbcTreeNode,
    children: JdbcTreeNode[],
    dialectId: string
  ) => JdbcTreeNode[];
};
