import type { FileEntity } from "../../contracts/files/FileEntity";

export const PAYLOADBUILDER_CATALOGS_VIEW_STATE_KEY = "payloadbuilder.catalogs";
const SCHEMA_VERSION = 1;

export type PayloadbuilderCatalogInstance = {
  alias: string;
  catalogId: string;
  title?: string;
  enabled: boolean;
  properties: Record<string, unknown>;
};

export type PayloadbuilderCatalogsDocument = {
  schemaVersion: number;
  instancesByAlias: Record<string, { catalogId: string; properties?: Record<string, unknown> }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeAlias(rawAlias: string): string {
  return rawAlias.trim();
}

export function validateAlias(rawAlias: string): string {
  const alias = normalizeAlias(rawAlias);
  if (!alias) {
    throw new Error("Alias is required");
  }
  return alias;
}

export function emptyCatalogDocument(): PayloadbuilderCatalogsDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    instancesByAlias: {}
  };
}

export function parseCatalogDocument(raw: unknown): PayloadbuilderCatalogsDocument {
  if (!isRecord(raw)) {
    return emptyCatalogDocument();
  }

  const instancesRaw = raw.instancesByAlias;
  const next: PayloadbuilderCatalogsDocument = {
    schemaVersion: SCHEMA_VERSION,
    instancesByAlias: {}
  };

  if (!isRecord(instancesRaw)) {
    return next;
  }

  for (const [rawAlias, value] of Object.entries(instancesRaw)) {
    const alias = normalizeAlias(rawAlias);
    if (!alias || !isRecord(value)) {
      continue;
    }
    const catalogId = typeof value.catalogId === "string" ? value.catalogId : "";
    if (!catalogId.trim()) {
      continue;
    }
    const properties = isRecord(value.properties) ? value.properties : {};
    next.instancesByAlias[alias] = {
      catalogId,
      properties
    };
  }

  return next;
}

export function listInstances(document: PayloadbuilderCatalogsDocument): PayloadbuilderCatalogInstance[] {
  return Object.entries(document.instancesByAlias)
    .map(([alias, value]) => ({
      alias,
      catalogId: value.catalogId,
      enabled: true,
      properties: value.properties ?? {}
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}

export function readDocumentFromFile(file: FileEntity | undefined): PayloadbuilderCatalogsDocument {
  if (!file) {
    return emptyCatalogDocument();
  }
  return parseCatalogDocument(file.persistentViewState?.[PAYLOADBUILDER_CATALOGS_VIEW_STATE_KEY]);
}

export function toEngineState(document: PayloadbuilderCatalogsDocument): unknown {
  if (Object.keys(document.instancesByAlias).length === 0) {
    return undefined;
  }
  return {
    payloadbuilder: {
      catalogs: document.instancesByAlias
    }
  };
}

export function applyEngineStatePatch(
  document: PayloadbuilderCatalogsDocument,
  engineStatePatch: unknown
): PayloadbuilderCatalogsDocument {
  if (!isRecord(engineStatePatch)) {
    return document;
  }
  const payloadbuilder = engineStatePatch.payloadbuilder;
  if (!isRecord(payloadbuilder)) {
    return document;
  }
  const patchCatalogs = payloadbuilder.catalogs;
  if (!isRecord(patchCatalogs)) {
    return document;
  }

  const merged: PayloadbuilderCatalogsDocument = {
    schemaVersion: SCHEMA_VERSION,
    instancesByAlias: {
      ...document.instancesByAlias
    }
  };

  for (const [rawAlias, patchValue] of Object.entries(patchCatalogs)) {
    const alias = normalizeAlias(rawAlias);
    if (!alias) {
      continue;
    }
    if (patchValue === null) {
      delete merged.instancesByAlias[alias];
      continue;
    }
    if (!isRecord(patchValue)) {
      continue;
    }
    const current = merged.instancesByAlias[alias];
    const nextCatalogId =
      typeof patchValue.catalogId === "string" && patchValue.catalogId.trim()
        ? patchValue.catalogId
        : current?.catalogId;
    if (!nextCatalogId) {
      continue;
    }

    const patchProperties = isRecord(patchValue.properties) ? patchValue.properties : {};
    merged.instancesByAlias[alias] = {
      catalogId: nextCatalogId,
      properties: {
        ...(current?.properties ?? {}),
        ...patchProperties
      }
    };
  }

  return merged;
}

export function upsertInstance(
  document: PayloadbuilderCatalogsDocument,
  input: { alias: string; catalogId: string; properties?: Record<string, unknown> }
): PayloadbuilderCatalogsDocument {
  const alias = validateAlias(input.alias);
  if (!input.catalogId.trim()) {
    throw new Error("catalogId is required");
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    instancesByAlias: {
      ...document.instancesByAlias,
      [alias]: {
        catalogId: input.catalogId,
        properties: input.properties ?? document.instancesByAlias[alias]?.properties ?? {}
      }
    }
  };
}

export function removeInstance(
  document: PayloadbuilderCatalogsDocument,
  alias: string
): PayloadbuilderCatalogsDocument {
  const normalizedAlias = validateAlias(alias);
  const next = { ...document.instancesByAlias };
  delete next[normalizedAlias];
  return {
    schemaVersion: SCHEMA_VERSION,
    instancesByAlias: next
  };
}

export function setInstanceProperty(
  document: PayloadbuilderCatalogsDocument,
  alias: string,
  propertyKey: string,
  value: unknown
): PayloadbuilderCatalogsDocument {
  const normalizedAlias = validateAlias(alias);
  if (!propertyKey.trim()) {
    throw new Error("propertyKey is required");
  }
  const current = document.instancesByAlias[normalizedAlias];
  if (!current) {
    throw new Error(`Unknown alias '${normalizedAlias}'`);
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    instancesByAlias: {
      ...document.instancesByAlias,
      [normalizedAlias]: {
        catalogId: current.catalogId,
        properties: {
          ...(current.properties ?? {}),
          [propertyKey]: value
        }
      }
    }
  };
}
