import type { Disposable } from "@queryeer/api/editor/EditorApi";
import { setDisposable } from "../../core/plugin-runtime/disposables";
import type {
  PayloadbuilderCatalogContribution,
  PayloadbuilderCatalogPanelProps,
  PayloadbuilderCatalogFlowMappingField,
  PayloadbuilderCatalogRegistry,
} from "@queryeer/api/queryengine/PayloadbuilderCatalogExtension.js";

export type { PayloadbuilderCatalogContribution, PayloadbuilderCatalogPanelProps, PayloadbuilderCatalogFlowMappingField };

/** Queryeer's own catalogs. */
const builtinsByCatalogId = new Map<string, PayloadbuilderCatalogContribution>();
/** Catalogs from plugins (`context.payloadbuilderCatalog`); one with a built-in's id replaces it while registered. */
const pluginContributionsByCatalogId = new Map<string, PayloadbuilderCatalogContribution>();
const listeners = new Set<() => void>();

/**
 * Adds or replaces a built-in catalog's contribution. Disposing removes it, unless a later registration replaced it.
 * A plugin's contribution with the same id takes precedence while it is registered.
 */
export function registerPayloadbuilderCatalogContribution(
  contribution: PayloadbuilderCatalogContribution
): Disposable {
  const registration = setDisposable(builtinsByCatalogId, contribution.catalogId, contribution, notifyListeners);
  notifyListeners();
  return registration;
}

/**
 * Adds a plugin's catalog contribution. It replaces a built-in one with the same id until it is disposed, which brings
 * the built-in back. Throws when another plugin's contribution has that id.
 */
export function registerPluginPayloadbuilderCatalogContribution(
  contribution: PayloadbuilderCatalogContribution
): Disposable {
  const sameIgnoringCase = (id: string) => id.toLowerCase() === contribution.catalogId.toLowerCase();
  if ([...pluginContributionsByCatalogId.keys()].some(sameIgnoringCase)) {
    throw new Error(`Payloadbuilder catalog '${contribution.catalogId}' is already registered by another plugin`);
  }
  // The backend matches catalog ids ignoring case; here a different spelling would sit next to the built-in
  const builtinSpelling = [...builtinsByCatalogId.keys()].find((id) => sameIgnoringCase(id) && id !== contribution.catalogId);
  if (builtinSpelling !== undefined) {
    throw new Error(`Payloadbuilder catalog '${contribution.catalogId}' must use the built-in catalog's id '${builtinSpelling}' to replace it`);
  }
  if (builtinsByCatalogId.has(contribution.catalogId)) {
    console.info(`[payloadbuilder] A plugin's catalog '${contribution.catalogId}' replaces the built-in one`);
  }
  const registration = setDisposable(pluginContributionsByCatalogId, contribution.catalogId, contribution, notifyListeners);
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
  return pluginContributionsByCatalogId.get(catalogId) ?? builtinsByCatalogId.get(catalogId);
}

export function listPayloadbuilderCatalogContributions(): PayloadbuilderCatalogContribution[] {
  const effective = new Map([...builtinsByCatalogId, ...pluginContributionsByCatalogId]);
  return [...effective.values()].sort((a, b) => {
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
    registerContribution: registerPluginPayloadbuilderCatalogContribution
  };
}
