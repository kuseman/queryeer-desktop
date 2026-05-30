import type {
  PayloadbuilderCatalogContribution,
  PayloadbuilderCatalogPanelProps,
  PayloadbuilderCatalogFlowMappingField,
} from "@queryeer/api/queryengine/PayloadbuilderCatalogExtension.js";

export type { PayloadbuilderCatalogContribution, PayloadbuilderCatalogPanelProps, PayloadbuilderCatalogFlowMappingField };

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
