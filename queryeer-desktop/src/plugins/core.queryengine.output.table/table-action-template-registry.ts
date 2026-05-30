import type { TableActionTemplateContribution } from "../../contracts/settings/TableActionTemplateContribution.js";

export type { TableActionTemplateContribution };

const templatesById = new Map<string, TableActionTemplateContribution>();
const listeners = new Set<() => void>();

export function registerTableActionTemplate(contribution: TableActionTemplateContribution): void {
  templatesById.set(contribution.id, contribution);
  for (const listener of listeners) {
    listener();
  }
}

export function listTableActionTemplates(): TableActionTemplateContribution[] {
  return [...templatesById.values()].sort((a, b) => {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return a.title.localeCompare(b.title);
  });
}

export function subscribeTableActionTemplates(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
