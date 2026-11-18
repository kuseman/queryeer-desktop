import type { Disposable } from "@queryeer/api/editor/EditorApi";
import type {
  SymbolActionRegistry,
  SymbolActionTemplateContribution
} from "@queryeer/api/queryengine/SymbolActionTemplateContribution.js";

export type { SymbolActionTemplateContribution };

const templatesById = new Map<string, SymbolActionTemplateContribution>();
const listeners = new Set<() => void>();

/**
 * Adds a template, replacing one with the same id. Disposing removes it unless a later registration replaced it.
 * Plugins reach this through `context.symbolActions.registerTemplate`.
 */
export function registerSymbolActionTemplate(contribution: SymbolActionTemplateContribution): Disposable {
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

export function listSymbolActionTemplates(): SymbolActionTemplateContribution[] {
  return [...templatesById.values()].sort((a, b) => {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return a.title.localeCompare(b.title);
  });
}

export function subscribeSymbolActionTemplates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The `context.symbolActions` every plugin gets. */
export function createSymbolActionRegistry(): SymbolActionRegistry {
  return { registerTemplate: registerSymbolActionTemplate };
}

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}
