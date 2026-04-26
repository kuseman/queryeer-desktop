import type { ReactNode } from "react";

export type PayloadbuilderCatalogPanelProps = {
  fileId: string;
  alias: string;
  catalogId: string;
  properties: Record<string, unknown>;
  setProperty: (propertyKey: string, value: unknown) => void;
};

export type PayloadbuilderCatalogContribution = {
  catalogId: string;
  title: string;
  order?: number;
  renderPanel: (props: PayloadbuilderCatalogPanelProps) => ReactNode;
  filterPersistedProperties?: (properties: Record<string, unknown>) => Record<string, unknown>;
  resolveRuntimeProperties?: (properties: Record<string, unknown>) => Record<string, unknown>;
};

const contributionsByCatalogId = new Map<string, PayloadbuilderCatalogContribution>();
const listeners = new Set<() => void>();

export function registerPayloadbuilderCatalogContribution(
  contribution: PayloadbuilderCatalogContribution
): void {
  contributionsByCatalogId.set(contribution.catalogId, contribution);
  for (const listener of listeners) {
    listener();
  }
}

export function getPayloadbuilderCatalogContribution(
  catalogId: string
): PayloadbuilderCatalogContribution | undefined {
  return contributionsByCatalogId.get(catalogId);
}

export function listPayloadbuilderCatalogContributions(): PayloadbuilderCatalogContribution[] {
  return [...contributionsByCatalogId.values()].sort((a, b) => {
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) {
      return orderDiff;
    }
    return a.title.localeCompare(b.title);
  });
}

export function subscribePayloadbuilderCatalogContributions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
