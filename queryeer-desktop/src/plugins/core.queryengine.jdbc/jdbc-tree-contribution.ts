import type { JdbcTreeNode } from "./jdbc-navigation-types";

export type JdbcTreeNodeContributor = {
  dialectId: string;
  getIcon?: (kind: string, attributes: Record<string, unknown>) => string | undefined;
  enrichChildren?: (
    parentNode: JdbcTreeNode,
    children: JdbcTreeNode[],
    dialectId: string
  ) => JdbcTreeNode[];
};

const DEFAULT_ICONS: Record<string, string> = {
  connection: "⊙",
  databases_container: "🗄",
  database: "⊞",
  schemas_container: "📂",
  schema: "○",
  tables_folder: "▤",
  views_folder: "◫",
  procedures_folder: "⚙",
  table: "▤",
  view: "◫",
  procedure: "⚙",
  column: "▸",
  primary_key: "🔑",
  foreign_key: "⇒",
  index: "◈"
};

const contributors: JdbcTreeNodeContributor[] = [];

export function registerJdbcTreeNodeContributor(contributor: JdbcTreeNodeContributor): void {
  contributors.push(contributor);
}

export function getJdbcTreeNodeContributors(dialectId: string): JdbcTreeNodeContributor[] {
  return contributors.filter((c) => c.dialectId === "*" || c.dialectId === dialectId);
}

export function getNodeIcon(
  kind: string,
  attributes: Record<string, unknown>,
  dialectId: string
): string {
  for (const contributor of getJdbcTreeNodeContributors(dialectId)) {
    const icon = contributor.getIcon?.(kind, attributes);
    if (icon !== undefined) {
      return icon;
    }
  }
  return DEFAULT_ICONS[kind] ?? "•";
}
