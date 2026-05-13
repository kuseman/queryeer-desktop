import type { SymbolAction } from "./symbol-action-types";

export type SymbolActionTemplateContribution = {
  id: string;
  title: string;
  description?: string;
  action: Omit<SymbolAction, "id">;
  order?: number;
};

const templatesById = new Map<string, SymbolActionTemplateContribution>();
const listeners = new Set<() => void>();

export function registerSymbolActionTemplate(contribution: SymbolActionTemplateContribution): void {
  templatesById.set(contribution.id, contribution);
  for (const listener of listeners) {
    listener();
  }
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
