import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type {
  JdbcTreeActionRegistry,
  TreeActionTemplateContribution
} from "@queryeer/api/settings/TreeActionTemplateContribution.js";

export type { TreeActionTemplateContribution };

const templatesById = new Map<string, TreeActionTemplateContribution>();
const listeners = new Set<() => void>();

/**
 * Adds a template, replacing one with the same id. Disposing removes it unless a later registration replaced it.
 * Plugins reach this through `context.jdbcTreeActions.registerTemplate`.
 */
export function registerTreeActionTemplate(contribution: TreeActionTemplateContribution): Disposable {
  templatesById.set(contribution.id, contribution);
  notify();
  return {
    dispose: () => {
      if (templatesById.get(contribution.id) !== contribution) return;
      templatesById.delete(contribution.id);
      notify();
    }
  };
}

export function listTreeActionTemplates(): TreeActionTemplateContribution[] {
  return [...templatesById.values()].sort((a, b) => {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return a.title.localeCompare(b.title);
  });
}

export function subscribeTreeActionTemplates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The `context.jdbcTreeActions` every plugin gets. */
export function createJdbcTreeActionRegistry(): JdbcTreeActionRegistry {
  return { registerTemplate: registerTreeActionTemplate };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}
