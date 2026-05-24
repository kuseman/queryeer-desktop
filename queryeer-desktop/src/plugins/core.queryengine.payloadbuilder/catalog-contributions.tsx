import type { ReactNode } from "react";

export type PayloadbuilderCatalogPanelProps = {
  fileId: string;
  alias: string;
  catalogId: string;
  properties: Record<string, unknown>;
  setProperty: (propertyKey: string, value: unknown) => void;
};

export type PayloadbuilderCatalogFlowMappingField = {
  id: string;
  label: string;
  placeholder?: string;
  kind?: "text" | "select";
  required?: boolean;
  /**
   * Persist the human-friendly option label in flow metadata and resolve to runtime value locally.
   * Use for local-only identifiers (for example UUID connection ids).
   */
  persistAsLabel?: boolean;
  /** Stable local-mapping kind owned by the contribution, for example "elasticsearch.connection". */
  mappingKind?: string;
  listOptions?: (values: Record<string, string>) => Array<string | { value: string; label: string }> | Promise<Array<string | { value: string; label: string }>>;
};

export type PayloadbuilderCatalogContribution = {
  catalogId: string;
  title: string;
  defaultAlias: string;
  allowMultiple: boolean;
  order?: number;
  renderPanel?: (props: PayloadbuilderCatalogPanelProps) => ReactNode;
  flowMappingFields?: PayloadbuilderCatalogFlowMappingField[];
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
