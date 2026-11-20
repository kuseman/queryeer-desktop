import type { Disposable } from "../editor/EditorApi.js";
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
  persistAsLabel?: boolean;
  mappingKind?: string;
  listOptions?: (
    values: Record<string, string>
  ) => Array<string | { value: string; label: string }> | Promise<Array<string | { value: string; label: string }>>;
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

export type PayloadbuilderCatalogRegistry = {
  /**
   * Adds a catalog. One with the id of a built-in catalog (`elasticsearch`, `kafka`, `mongodb`, `filesystem`, `http`)
   * replaces it until disposed, which brings the built-in back (since 0.21); replace the backend half too. Throws when another plugin already
   * registered that id.
   */
  registerContribution(contribution: PayloadbuilderCatalogContribution): Disposable;
};
