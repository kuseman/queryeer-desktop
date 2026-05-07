import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import {
  applyEngineStatePatch,
  emptyCatalogDocument,
  readDocumentFromFile,
  setSelectedEnvironmentId,
  setInstanceProperty,
  type PayloadbuilderCatalogInstance,
  type PayloadbuilderCatalogsDocument,
  PAYLOADBUILDER_CATALOGS_VIEW_STATE_KEY,
  validateAlias
} from "./catalog-state";
import { getPayloadbuilderCatalogContribution } from "./catalog-contributions";
import { getConfiguredCatalogAliases } from "./catalog-settings";

type Listener = () => void;

let instance: PayloadbuilderCatalogStore | undefined;

export function getPayloadbuilderCatalogStore(): PayloadbuilderCatalogStore {
  if (!instance) {
    instance = new PayloadbuilderCatalogStore();
  }
  return instance;
}

export class PayloadbuilderCatalogStore {
  private filesRegistry: FilesRegistry | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly runtimeDocumentsByFileId = new Map<string, PayloadbuilderCatalogsDocument>();

  initialize(filesRegistry: FilesRegistry): void {
    this.filesRegistry = filesRegistry;
    this.runtimeDocumentsByFileId.clear();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  listInstances(fileId: string | undefined): PayloadbuilderCatalogInstance[] {
    const document = this.readDocument(fileId);
    const configured = getConfiguredCatalogAliases();
    const instances: PayloadbuilderCatalogInstance[] = [];
    const seenAliases = new Set<string>();

    for (const definition of configured) {
      const persisted = document.instancesByAlias[definition.alias];
      seenAliases.add(definition.alias);
      instances.push({
        alias: definition.alias,
        catalogId: definition.catalogId,
        title: definition.title,
        enabled: definition.enabled,
        properties: persisted?.properties ?? {}
      });
    }

    const dynamicInstances = Object.entries(document.instancesByAlias)
      .filter(([alias]) => !seenAliases.has(alias))
      .sort(([aliasA], [aliasB]) => aliasA.localeCompare(aliasB))
      .map(([alias, value]) => ({
        alias,
        catalogId: value.catalogId,
        enabled: true,
        properties: value.properties ?? {}
      }));

    return [...instances, ...dynamicInstances];
  }

  buildEngineState(fileId: string | undefined): unknown {
    const document = this.readDocument(fileId);
    const instances = this.listInstances(fileId);
    if (!document.selectedEnvironmentId && instances.length === 0) {
      return undefined;
    }
    const catalogs: Record<string, { catalogId: string; properties: Record<string, unknown> }> = {};
    for (const instance of instances) {
      if (!instance.enabled) {
        continue;
      }
      catalogs[instance.alias] = {
        catalogId: instance.catalogId,
        properties: resolveRuntimeProperties(instance.catalogId, instance.properties)
      };
    }
    if (!document.selectedEnvironmentId && Object.keys(catalogs).length === 0) {
      return undefined;
    }
    const defaultCatalogAlias =
      document.defaultCatalogAlias && catalogs[document.defaultCatalogAlias]
        ? document.defaultCatalogAlias
        : undefined;
    return {
      payloadbuilder: {
        ...(document.selectedEnvironmentId
          ? { selectedEnvironmentId: document.selectedEnvironmentId }
          : {}),
        defaultCatalogAlias,
        catalogs
      }
    };
  }

  getCatalogMeta(fileId: string | undefined): {
    enabledAliases: string[];
    selectedEnvironmentId: string | undefined;
    defaultCatalogAlias: string | undefined;
  } {
    const document = this.readDocument(fileId);
    const enabledAliases = this.listInstances(fileId)
      .filter((i) => i.enabled)
      .map((i) => i.alias);
    return {
      enabledAliases,
      selectedEnvironmentId: document.selectedEnvironmentId,
      defaultCatalogAlias: document.defaultCatalogAlias
    };
  }

  setSelectedEnvironmentId(fileId: string, environmentId: string | undefined): void {
    const document = this.readDocument(fileId);
    this.writeDocument(fileId, setSelectedEnvironmentId(document, environmentId));
  }

  setDefaultCatalogAlias(fileId: string, alias: string | undefined): void {
    const document = this.readDocument(fileId);
    const next = {
      ...document,
      defaultCatalogAlias: alias?.trim() || undefined
    };
    this.writeDocument(fileId, next);
  }

  setProperty(fileId: string, alias: string, propertyKey: string, value: unknown): void {
    const document = this.readDocument(fileId);
    const normalizedAlias = validateAlias(alias);
    const configured = getConfiguredCatalogAliases().find((x) => x.alias === normalizedAlias);
    if (configured && !document.instancesByAlias[normalizedAlias]) {
      document.instancesByAlias[normalizedAlias] = {
        catalogId: configured.catalogId,
        properties: {}
      };
    }
    const next = setInstanceProperty(document, normalizedAlias, propertyKey, value);
    this.writeDocument(fileId, next);
  }

  applyEngineStatePatch(fileId: string, engineStatePatch: unknown): void {
    const next = applyEngineStatePatch(this.readDocument(fileId), engineStatePatch);
    this.writeDocument(fileId, next);
  }

  private readDocument(fileId: string | undefined): PayloadbuilderCatalogsDocument {
    if (!fileId || !this.filesRegistry) {
      return emptyCatalogDocument();
    }
    const persistedDocument = readDocumentFromFile(this.filesRegistry.getFile(fileId));
    const runtimeDocument = this.runtimeDocumentsByFileId.get(fileId);
    if (!runtimeDocument) {
      return persistedDocument;
    }
    return mergeDocuments(persistedDocument, runtimeDocument);
  }

  private writeDocument(fileId: string, document: PayloadbuilderCatalogsDocument): void {
    if (!this.filesRegistry) {
      return;
    }
    const file = this.filesRegistry.getFile(fileId);
    if (!file) {
      return;
    }

    this.runtimeDocumentsByFileId.set(fileId, document);

    const sanitizedDocument = sanitizeDocument(document);

    this.filesRegistry.updateFile(fileId, {
      persistentViewState: {
        ...(file.persistentViewState ?? {}),
        [PAYLOADBUILDER_CATALOGS_VIEW_STATE_KEY]: sanitizedDocument
      }
    });

    for (const listener of this.listeners) {
      listener();
    }
  }
}

function sanitizeDocument(document: PayloadbuilderCatalogsDocument): PayloadbuilderCatalogsDocument {
  const instancesByAlias: PayloadbuilderCatalogsDocument["instancesByAlias"] = {};
  for (const [alias, instance] of Object.entries(document.instancesByAlias)) {
    instancesByAlias[alias] = {
      ...instance,
      properties: sanitizePersistedProperties(instance.catalogId, instance.properties ?? {})
    };
  }
  return {
    ...document,
    instancesByAlias
  };
}

function sanitizePersistedProperties(
  catalogId: string,
  properties: Record<string, unknown>
): Record<string, unknown> {
  const contribution = getPayloadbuilderCatalogContribution(catalogId);
  if (!contribution?.filterPersistedProperties) {
    return properties;
  }
  return contribution.filterPersistedProperties(properties);
}

function resolveRuntimeProperties(
  catalogId: string,
  properties: Record<string, unknown>
): Record<string, unknown> {
  const contribution = getPayloadbuilderCatalogContribution(catalogId);
  if (!contribution?.resolveRuntimeProperties) {
    return properties;
  }
  return contribution.resolveRuntimeProperties(properties);
}

function mergeDocuments(
  persistedDocument: PayloadbuilderCatalogsDocument,
  runtimeDocument: PayloadbuilderCatalogsDocument
): PayloadbuilderCatalogsDocument {
  const instancesByAlias: PayloadbuilderCatalogsDocument["instancesByAlias"] = {
    ...persistedDocument.instancesByAlias
  };
  for (const [alias, runtimeInstance] of Object.entries(runtimeDocument.instancesByAlias)) {
    const persistedInstance = persistedDocument.instancesByAlias[alias];
    instancesByAlias[alias] = {
      catalogId: runtimeInstance.catalogId,
      properties: {
        ...(persistedInstance?.properties ?? {}),
        ...(runtimeInstance.properties ?? {})
      }
    };
  }
  return {
    schemaVersion: runtimeDocument.schemaVersion,
    defaultCatalogAlias: runtimeDocument.defaultCatalogAlias ?? persistedDocument.defaultCatalogAlias,
    selectedEnvironmentId:
      runtimeDocument.selectedEnvironmentId ?? persistedDocument.selectedEnvironmentId,
    instancesByAlias
  };
}
