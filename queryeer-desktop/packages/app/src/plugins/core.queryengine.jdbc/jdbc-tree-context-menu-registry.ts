import type { JdbcTreeNode } from "./jdbc-navigation-types";
import type { JdbcTreeContextMenuContribution, JdbcTreeContextMenuRegistry } from "./jdbc-tree-context-menu-types";

let sharedRegistry: JdbcTreeContextMenuRegistry | null = null;

export function getJdbcTreeContextMenuRegistry(): JdbcTreeContextMenuRegistry {
  if (!sharedRegistry) {
    sharedRegistry = createJdbcTreeContextMenuRegistry();
  }
  return sharedRegistry;
}

export function resetJdbcTreeContextMenuRegistry(): void {
  sharedRegistry = null;
}

function createJdbcTreeContextMenuRegistry(): JdbcTreeContextMenuRegistry {
  const contributions = new Map<string, JdbcTreeContextMenuContribution>();

  return {
    registerContribution(contribution: JdbcTreeContextMenuContribution): void {
      contributions.set(contribution.id, contribution);
    },

    unregisterContribution(id: string): void {
      contributions.delete(id);
    },

    getItemsForNode(node: JdbcTreeNode): Array<{
      id: string;
      label: string;
      disabled?: boolean;
      section?: string;
      onSelect: () => void | Promise<void>;
    }> {
      const matching = Array.from(contributions.values())
        .filter((c) => c.matches(node))
        .sort((a, b) => a.order - b.order);

      return matching.map((c) => ({
        id: c.id,
        label: c.label,
        section: c.section,
        onSelect: () => c.run(node),
      }));
    }
  };
}
