import type { JdbcTreeNode } from "./jdbc-navigation-types.js";
import type {
  JdbcTreeContextMenuContribution as JdbcTreeContextMenuContributionBase,
  JdbcTreeContextMenuRegistry as JdbcTreeContextMenuRegistryBase
} from "../../contracts/extensions/JdbcTreeContextMenuExtension.js";

export type JdbcTreeContextMenuContribution = JdbcTreeContextMenuContributionBase<JdbcTreeNode>;
export type JdbcTreeContextMenuRegistry = JdbcTreeContextMenuRegistryBase<JdbcTreeNode>;
