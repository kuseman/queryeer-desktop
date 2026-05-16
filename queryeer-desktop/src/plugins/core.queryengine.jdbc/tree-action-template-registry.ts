import type { TreeAction } from "./tree-action-types";

export type TreeActionTemplateContribution = {
  id: string;
  title: string;
  description?: string;
  action: Omit<TreeAction, "id">;
  order?: number;
};

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
