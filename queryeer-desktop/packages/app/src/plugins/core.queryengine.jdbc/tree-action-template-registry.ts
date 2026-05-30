import type { TreeActionTemplateContribution } from "@queryeer/api/settings/TreeActionTemplateContribution.js";

export type { TreeActionTemplateContribution };

const templatesById = new Map<string, TreeActionTemplateContribution>();
const listeners = new Set<() => void>();

export function registerTreeActionTemplate(contribution: TreeActionTemplateContribution): void {
  templatesById.set(contribution.id, contribution);
  for (const listener of listeners) {
    listener();
  }
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
