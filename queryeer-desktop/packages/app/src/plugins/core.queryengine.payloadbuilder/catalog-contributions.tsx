import type { Disposable } from "@queryeer/api/editor/EditorApi";
import { setDisposable } from "../../core/plugin-runtime/disposables";
import type {
  PayloadbuilderCatalogContribution,
  PayloadbuilderCatalogPanelProps,
  PayloadbuilderCatalogFlowMappingField,
  PayloadbuilderCatalogRegistry,
} from "@queryeer/api/queryengine/PayloadbuilderCatalogExtension.js";

export type { PayloadbuilderCatalogContribution, PayloadbuilderCatalogPanelProps, PayloadbuilderCatalogFlowMappingField };

const contributionsByCatalogId = new Map<string, PayloadbuilderCatalogContribution>();
const listeners = new Set<() => void>();

/** Adds or replaces the catalog's contribution. Disposing removes it, unless a later registration replaced it. */
export function registerPayloadbuilderCatalogContribution(
  contribution: PayloadbuilderCatalogContribution
): Disposable {
  const registration = setDisposable(contributionsByCatalogId, contribution.catalogId, contribution, notifyListeners);
  notifyListeners();
  return registration;
}

function notifyListeners(): void {
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

export function createPayloadbuilderCatalogRegistry(): PayloadbuilderCatalogRegistry {
  return {
    registerContribution: registerPayloadbuilderCatalogContribution
  };
}
