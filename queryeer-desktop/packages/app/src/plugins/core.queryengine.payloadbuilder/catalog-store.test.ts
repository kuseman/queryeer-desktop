import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileRegistry } from "../../core/plugin-runtime/FileRegistry";
import { getPayloadbuilderCatalogStore } from "./catalog-store";
import { PAYLOADBUILDER_CATALOGS_VIEW_STATE_KEY } from "./catalog-state";
import type { PayloadbuilderCatalogAliasDefinition } from "./catalog-settings";

const getConfiguredCatalogAliasesMock = vi.fn<() => PayloadbuilderCatalogAliasDefinition[]>(() => []);

vi.mock("./catalog-settings", () => ({
  getConfiguredCatalogAliases: () => getConfiguredCatalogAliasesMock()
}));

vi.mock("./catalog-contributions", () => ({
  getPayloadbuilderCatalogContribution: (catalogId: string) => {
    if (catalogId !== "elasticsearch") {
      return undefined;
    }
    return {
      catalogId: "elasticsearch",
      title: "Elasticsearch",
      defaultAlias: "es",
      allowMultiple: true,
      filterPersistedProperties: (properties: Record<string, unknown>) => ({
        connectionId: typeof properties.connectionId === "string" ? properties.connectionId : "",
        index: typeof properties.index === "string" ? properties.index : ""
      }),
      resolveRuntimeProperties: (properties: Record<string, unknown>) => {
        const connectionId = typeof properties.connectionId === "string" ? properties.connectionId : "";
        if (connectionId !== "cluster1") {
          return properties;
        }
        return {
          ...properties,
          endpoint: "https://localhost:9200",
          authType: "BASIC",
          authUsername: "elastic",
          authPassword: "secret"
        };
      }
    };
  }
}));

describe("payloadbuilder catalog store", () => {
  beforeEach(() => {
    getConfiguredCatalogAliasesMock.mockReset();
    getConfiguredCatalogAliasesMock.mockReturnValue([]);

    const fileRegistry = new FileRegistry().createFilesRegistry();
    getPayloadbuilderCatalogStore().initialize(fileRegistry);
  });

  it("persists document under payloadbuilder.catalogs key per file", () => {
    const filesRegistry = new FileRegistry().createFilesRegistry();
    const store = getPayloadbuilderCatalogStore();
    store.initialize(filesRegistry);

    const fileOne = filesRegistry.openFile({
      uri: "untitled:file-one",
      mimeType: "application/sql"
    });
    const fileTwo = filesRegistry.openFile({
      uri: "untitled:file-two",
      mimeType: "application/sql"
    });

    store.applyEngineStatePatch(fileOne.fileId, {
      payloadbuilder: {
        catalogs: {
          jdbc1: {
            catalogId: "Jdbc",
            properties: {
              database: "appdb"
            }
          }
        }
      }
    });
    store.applyEngineStatePatch(fileTwo.fileId, {
      payloadbuilder: {
        catalogs: {
          jdbc2: {
            catalogId: "Jdbc",
            properties: {
              database: "reporting"
            }
          }
        }
      }
    });

    const persistedOne = filesRegistry.getFile(fileOne.fileId)?.persistentViewState;
    const persistedTwo = filesRegistry.getFile(fileTwo.fileId)?.persistentViewState;

    expect(persistedOne?.[PAYLOADBUILDER_CATALOGS_VIEW_STATE_KEY]).toBeDefined();
    expect(persistedTwo?.[PAYLOADBUILDER_CATALOGS_VIEW_STATE_KEY]).toBeDefined();
    expect(store.listInstances(fileOne.fileId).map((x) => x.alias)).toEqual(["jdbc1"]);
    expect(store.listInstances(fileTwo.fileId).map((x) => x.alias)).toEqual(["jdbc2"]);
  });

  it("keeps configured alias order and appends dynamic aliases", () => {
    getConfiguredCatalogAliasesMock.mockReturnValue([
      { alias: "jdbc2", catalogId: "Jdbc", title: "Reports", enabled: false },
      { alias: "jdbc1", catalogId: "Jdbc", enabled: true }
    ]);

    const filesRegistry = new FileRegistry().createFilesRegistry();
    const store = getPayloadbuilderCatalogStore();
    store.initialize(filesRegistry);

    const file = filesRegistry.openFile({
      uri: "untitled:file-order",
      mimeType: "application/sql"
    });

    store.applyEngineStatePatch(file.fileId, {
      payloadbuilder: {
        catalogs: {
          jdbc1: { catalogId: "Jdbc", properties: { database: "appdb" } },
          jdbc2: { catalogId: "Jdbc", properties: { database: "reporting" } },
          jdbc3: { catalogId: "Jdbc", properties: { database: "ad-hoc" } }
        }
      }
    });

    const instances = store.listInstances(file.fileId);
    expect(instances.map((x) => x.alias)).toEqual(["jdbc2", "jdbc1", "jdbc3"]);
    expect(instances[0]?.title).toBe("Reports");
    expect(instances[0]?.enabled).toBe(false);
    expect(instances[1]?.properties).toEqual({ database: "appdb" });
    expect(instances[2]?.enabled).toBe(true);
  });

  it("builds engine state from enabled aliases only", () => {
    getConfiguredCatalogAliasesMock.mockReturnValue([
      { alias: "jdbc1", catalogId: "Jdbc", enabled: false },
      { alias: "jdbc2", catalogId: "Jdbc", enabled: true }
    ]);

    const filesRegistry = new FileRegistry().createFilesRegistry();
    const store = getPayloadbuilderCatalogStore();
    store.initialize(filesRegistry);

    const file = filesRegistry.openFile({
      uri: "untitled:file-enabled",
      mimeType: "application/sql"
    });

    store.applyEngineStatePatch(file.fileId, {
      payloadbuilder: {
        catalogs: {
          jdbc1: { catalogId: "Jdbc", properties: { database: "hidden" } },
          jdbc2: { catalogId: "Jdbc", properties: { database: "visible" } }
        }
      }
    });

    expect(store.buildEngineState(file.fileId)).toEqual({
      payloadbuilder: {
        catalogs: {
          jdbc2: {
            catalogId: "Jdbc",
            properties: { database: "visible" }
          }
        }
      }
    });

    getConfiguredCatalogAliasesMock.mockReturnValue([
      { alias: "jdbc1", catalogId: "Jdbc", enabled: false },
      { alias: "jdbc2", catalogId: "Jdbc", enabled: false }
    ]);

    expect(store.buildEngineState(file.fileId)).toBeUndefined();
  });

  it("includes valid default catalog alias in engine state", () => {
    getConfiguredCatalogAliasesMock.mockReturnValue([
      { alias: "jdbc1", catalogId: "Jdbc", enabled: true },
      { alias: "jdbc2", catalogId: "Jdbc", enabled: true }
    ]);

    const filesRegistry = new FileRegistry().createFilesRegistry();
    const store = getPayloadbuilderCatalogStore();
    store.initialize(filesRegistry);

    const file = filesRegistry.openFile({
      uri: "untitled:file-default",
      mimeType: "application/sql"
    });

    store.setDefaultCatalogAlias(file.fileId, "jdbc2");
    expect(store.buildEngineState(file.fileId)).toEqual({
      payloadbuilder: {
        defaultCatalogAlias: "jdbc2",
        catalogs: {
          jdbc1: { catalogId: "Jdbc", properties: {} },
          jdbc2: { catalogId: "Jdbc", properties: {} }
        }
      }
    });
  });

  it("filters persisted viewstate but keeps runtime engine payload", () => {
    getConfiguredCatalogAliasesMock.mockReturnValue([
      { alias: "es1", catalogId: "elasticsearch", enabled: true }
    ]);

    const filesRegistry = new FileRegistry().createFilesRegistry();
    const store = getPayloadbuilderCatalogStore();
    store.initialize(filesRegistry);

    const file = filesRegistry.openFile({
      uri: "untitled:file-es",
      mimeType: "application/sql"
    });

    store.applyEngineStatePatch(file.fileId, {
      payloadbuilder: {
        catalogs: {
          es1: {
            catalogId: "elasticsearch",
            properties: {
              connectionId: "cluster1",
              index: "logs-*"
            }
          }
        }
      }
    });

    expect(store.listInstances(file.fileId)[0]?.properties).toEqual({
      connectionId: "cluster1",
      index: "logs-*"
    });
    expect(store.buildEngineState(file.fileId)).toEqual({
      payloadbuilder: {
        catalogs: {
          es1: {
            catalogId: "elasticsearch",
            properties: {
              connectionId: "cluster1",
              index: "logs-*",
              authType: "BASIC",
              authUsername: "elastic",
              authPassword: "secret",
              endpoint: "https://localhost:9200"
            }
          }
        }
      }
    });

    const persisted = filesRegistry.getFile(file.fileId)?.persistentViewState?.[
      PAYLOADBUILDER_CATALOGS_VIEW_STATE_KEY
    ] as {
      instancesByAlias: Record<string, { properties: Record<string, unknown> }>;
    };
    expect(persisted.instancesByAlias.es1?.properties).toEqual({
      connectionId: "cluster1",
      index: "logs-*"
    });

    store.initialize(filesRegistry);
    expect(store.listInstances(file.fileId)[0]?.properties).toEqual({
      connectionId: "cluster1",
      index: "logs-*"
    });
  });

  it("persists selected environment id in file view state", () => {
    const filesRegistry = new FileRegistry().createFilesRegistry();
    const store = getPayloadbuilderCatalogStore();
    store.initialize(filesRegistry);
    const file = filesRegistry.openFile({
      uri: "untitled:file-env",
      mimeType: "application/sql"
    });

    store.setSelectedEnvironmentId(file.fileId, "prod");

    expect(store.buildEngineState(file.fileId)).toEqual({
      payloadbuilder: {
        selectedEnvironmentId: "prod",
        defaultCatalogAlias: undefined,
        catalogs: {}
      }
    });
    const persisted = filesRegistry.getFile(file.fileId)?.persistentViewState?.[
      PAYLOADBUILDER_CATALOGS_VIEW_STATE_KEY
    ] as { selectedEnvironmentId?: string };
    expect(persisted.selectedEnvironmentId).toBe("prod");
  });

  it("builds execution state from the latest environment and catalog selections", () => {
    getConfiguredCatalogAliasesMock.mockReturnValue([
      { alias: "jdbc1", catalogId: "Jdbc", enabled: true }
    ]);
    const filesRegistry = new FileRegistry().createFilesRegistry();
    const store = getPayloadbuilderCatalogStore();
    store.initialize(filesRegistry);
    const file = filesRegistry.openFile({
      uri: "untitled:file-latest-state",
      mimeType: "application/plbsql"
    });

    store.setSelectedEnvironmentId(file.fileId, "dev");
    store.setProperty(file.fileId, "jdbc1", "connectionId", "first");
    store.setProperty(file.fileId, "jdbc1", "database", "old-db");
    store.setSelectedEnvironmentId(file.fileId, "prod");
    store.setProperty(file.fileId, "jdbc1", "connectionId", "second");
    store.setProperty(file.fileId, "jdbc1", "database", "new-db");

    expect(store.buildEngineState(file.fileId)).toEqual({
      payloadbuilder: {
        selectedEnvironmentId: "prod",
        defaultCatalogAlias: undefined,
        catalogs: {
          jdbc1: {
            catalogId: "Jdbc",
            properties: {
              connectionId: "second",
              database: "new-db"
            }
          }
        }
      }
    });
  });

  it("does not apply a completion patch after the submitted connection changed", () => {
    getConfiguredCatalogAliasesMock.mockReturnValue([
      { alias: "jdbc1", catalogId: "Jdbc", enabled: true }
    ]);
    const filesRegistry = new FileRegistry().createFilesRegistry();
    const store = getPayloadbuilderCatalogStore();
    store.initialize(filesRegistry);
    const file = filesRegistry.openFile({
      uri: "untitled:file-stale-completion",
      mimeType: "application/plbsql"
    });
    store.setProperty(file.fileId, "jdbc1", "connectionId", "first");
    store.setProperty(file.fileId, "jdbc1", "database", "appdb");
    const submittedEngineState = store.buildEngineState(file.fileId);

    store.setProperty(file.fileId, "jdbc1", "connectionId", "second");
    store.setProperty(file.fileId, "jdbc1", "database", "production");
    const applied = store.applyEngineStatePatch(
      file.fileId,
      {
        payloadbuilder: {
          sessionId: "old-session",
          catalogs: {
            jdbc1: { catalogId: "Jdbc", properties: { database: "reporting" } }
          }
        }
      },
      submittedEngineState
    );

    expect(applied).toBe(false);
    expect(store.listInstances(file.fileId)[0]?.properties).toEqual({
      connectionId: "second",
      database: "production"
    });
  });
});
