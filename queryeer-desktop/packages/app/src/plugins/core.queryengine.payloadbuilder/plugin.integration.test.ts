import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { PayloadbuilderCatalogContribution } from "./catalog-contributions";
import {
  clearFlowNodeTypeContributionsForTests,
  getFlowNodeTypeContribution
} from "../core.flow/flow-node-type-contributions";

const mocks = vi.hoisted(() => ({
  registerExecutionContextProviderMock: vi.fn(),
  registerEngineResolverMock: vi.fn(),
  onQueryEventMock: vi.fn(),
  executeQueryForFlowMock: vi.fn(),
  buildEngineStateMock: vi.fn(),
  applyEngineStatePatchMock: vi.fn(),
  initializeStoreMock: vi.fn(),
  getCoreSettingsServiceMock: vi.fn<() => unknown | null>(() => null),
  listContributionsMock: vi.fn<() => PayloadbuilderCatalogContribution[]>(() => []),
  subscribeContributionsMock: vi.fn<(listener: () => void) => () => void>(() => () => {}),
  onSettingsInitializedMock: vi.fn<(listener: (service: unknown) => void) => () => void>(() => () => {})
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({
    registerExecutionContextProvider: mocks.registerExecutionContextProviderMock,
    registerEngineResolver: mocks.registerEngineResolverMock,
    onQueryEvent: mocks.onQueryEventMock
  })
}));

vi.mock("../core.queryengine/flow-query-execution", () => ({
  executeQueryForFlow: mocks.executeQueryForFlowMock
}));

vi.mock("./catalog-store", () => ({
  getPayloadbuilderCatalogStore: () => ({
    initialize: mocks.initializeStoreMock,
    buildEngineState: mocks.buildEngineStateMock,
    applyEngineStatePatch: mocks.applyEngineStatePatchMock,
    setDefaultCatalogAlias: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    getCatalogMeta: vi.fn(() => ({ enabledAliases: [], selectedEnvironmentId: undefined, defaultCatalogAlias: undefined }))
  })
}));

vi.mock("./catalog-contributions", () => ({
  listPayloadbuilderCatalogContributions: () => mocks.listContributionsMock(),
  subscribePayloadbuilderCatalogContributions: (listener: () => void) =>
    mocks.subscribeContributionsMock(listener)
}));

vi.mock("../core.settings/service", () => ({
  getCoreSettingsService: () => mocks.getCoreSettingsServiceMock(),
  onCoreSettingsServiceInitialized: (listener: (service: unknown) => void) =>
    mocks.onSettingsInitializedMock(listener)
}));

import { coreQueryEnginePayloadbuilderPlugin } from "./plugin";

function createContext(): PluginContext {
  const filesById = new Map<string, FileEntity>([
    [
      "file-1",
      {
        fileId: "file-1",
        version: 1,
        uri: "file:///file-1.plbsql",
        mimeType: "application/plbsql",
        dirtyVsBackend: false,
        dirtyVsDisk: false,
        diskState: "inSync",
        openedAt: new Date().toISOString(),
        metadata: {}
      }
    ],
    [
      "file-sql",
      {
        fileId: "file-sql",
        version: 1,
        uri: "file:///file-sql.sql",
        mimeType: "application/sql",
        dirtyVsBackend: false,
        dirtyVsDisk: false,
        diskState: "inSync",
        openedAt: new Date().toISOString(),
        metadata: {}
      }
    ]
  ]);

  return {
    commands: {
      registerCommand: vi.fn(),
      executeCommand: vi.fn(async () => ({ commandId: "noop", executed: true })),
      canExecuteCommand: vi.fn(() => true)
    },
    filesystems: { registerFileSystem: vi.fn() },
    graphNodeTypes: { registerNodeType: vi.fn(), unregisterNodeType: vi.fn(), getComponent: vi.fn(), getAll: vi.fn(() => new Map()) },
    files: {
      capabilities: {
        registerCapabilities: vi.fn(),
        registerLabel: vi.fn(),
        registerPreferredNewFileMimeType: vi.fn(),
        listPreferredNewFileMimeTypes: vi.fn(() => []),
        getLabel: vi.fn(),
        hasCapability: vi.fn(() => true),
        listMimeTypesByCapability: vi.fn(() => []),
        listAllMimeTypes: vi.fn(() => []),
        registerContentCategory: vi.fn(),
        getContentCategory: vi.fn(() => "text" as const)
      },
      mimeIcons: {
        registerMimeIcon: vi.fn(),
        getMimeIcon: vi.fn(),
        listMimeIcons: vi.fn(() => [])
      },
      openFile: vi.fn(),
      closeFile: vi.fn(),
      getFile: vi.fn((fileId: string) => filesById.get(fileId)),
      listFiles: vi.fn(() => [...filesById.values()]),
      updateFile: vi.fn((fileId: string, update: Partial<FileEntity>) => {
        const existing = filesById.get(fileId);
        if (!existing) return undefined;
        const next = { ...existing, ...update } as FileEntity;
        filesById.set(fileId, next);
        return next;
      }),
      subscribe: vi.fn(() => () => {}),
      registerMimeResolver: vi.fn(),
      registerEditorResolver: vi.fn(),
      classifyUri: vi.fn(() => "application/sql"),
      resolveEditor: vi.fn(),
      getEditorState: vi.fn(),
      setEditorState: vi.fn(),
      markDirty: vi.fn()
    },
    fileMediator: {
      openFile: vi.fn(),
      createUntitledFile: vi.fn(),
      getUntitledCounter: vi.fn(() => 0),
      setUntitledCounter: vi.fn(),
      closeFile: vi.fn(),
      saveFile: vi.fn(),
      setActiveFileId: vi.fn(),
      getActiveFileId: vi.fn(() => null),
      setContextFileId: vi.fn(),
      getContextFileId: vi.fn(() => null),
      bindEngine: vi.fn(),
      reloadFile: vi.fn(),
      acceptExternalChange: vi.fn(),
      discardExternalChange: vi.fn(),
      onActiveFileChanged: vi.fn(() => () => {})
    },
    fileWatcher: {
      watch: vi.fn(),
      mutePath: vi.fn()
    },
    layout: {
      registerToolbarAction: vi.fn(),
      registerStatusItem: vi.fn(),
      registerView: vi.fn(),
      registerEditor: vi.fn(),
      registerWelcome: vi.fn(),
      registerTabContextMenu: vi.fn(),
      registerTabHeaderStyle: vi.fn(),
      registerTabTitle: vi.fn(),
      registerPanel: vi.fn(),
      setShellDefaults: vi.fn()
    },
    menu: {
      registerMenuItem: vi.fn(),
      rebuildMenu: vi.fn(),
      onRebuild: vi.fn()
    },
    keybindings: { registerKeybinding: vi.fn() },
    dialog: {
      showMessage: vi.fn(),
      showOpenDialog: vi.fn(),
      showOpenFolder: vi.fn(),
      showSaveDialog: vi.fn()
    },
    tooltip: { registerTooltipSection: vi.fn() },
    fileState: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), evict: vi.fn() },
    settings: {
      registerSettings: vi.fn(),
      registerAdvancedRenderer: vi.fn(),
      registerAdvancedValidator: vi.fn(),
      listSettingsContributions: vi.fn(() => []),
      listSettingsDefinitions: vi.fn(() => []),
      getAdvancedRenderer: vi.fn(),
      getAdvancedValidator: vi.fn()
    },
    quickcommand: { registerProvider: vi.fn() },
    contextMenu: { registerProvider: vi.fn(), unregisterProvider: vi.fn() },
    tableOutputContextMenu: { registerProvider: vi.fn(), unregisterProvider: vi.fn() },
    jdbcTreeContextMenu: { registerContribution: vi.fn(), unregisterContribution: vi.fn(), getItemsForNode: vi.fn() },
    jdbcDrivers: { registerDriver: vi.fn(), listDrivers: vi.fn(() => []), getDriver: vi.fn(), subscribe: vi.fn(() => () => {}) },
    outline: {
      registerOutlineProvider: vi.fn(),
      registerSupplementaryOutlineProvider: vi.fn(),
      hasProvider: vi.fn(() => false),
      getProvider: vi.fn(),
      getSymbols: vi.fn()
    },
    editors: {
      getActiveEditor: vi.fn(() => null),
      setActiveEditor: vi.fn(),
      onActiveEditorChanged: vi.fn(() => ({ dispose: vi.fn() }))
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    components: { FrameworkEditor: vi.fn() as any },
    about: { registerChangelog: vi.fn() },
    notifications: createNotificationMock(),
    assistant: createAssistantRegistryMock(),
    payloadbuilderCatalog: { registerContribution: vi.fn() }
  };
}

function createAssistantRegistryMock() {
  return {
    registerContextContribution: vi.fn(() => () => {}),
    registerToolContribution: vi.fn(() => () => {}),
    collectContext: vi.fn(async () => []),
    listTools: vi.fn(() => []),
    invokeTool: vi.fn(async () => ({ ok: false }))
  };
}

function createNotificationMock() {
  return {
    notify: vi.fn(),
    list: vi.fn(() => []),
    unreadCount: vi.fn(() => 0),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    dismissToast: vi.fn(),
    clear: vi.fn(),
    clearAll: vi.fn(),
    subscribe: vi.fn(() => () => {})
  };
}

describe("core.queryengine.payloadbuilder plugin integration", () => {
  beforeEach(() => {
    mocks.registerExecutionContextProviderMock.mockReset();
    mocks.registerEngineResolverMock.mockReset();
    mocks.onQueryEventMock.mockReset();
    mocks.executeQueryForFlowMock.mockReset();
    mocks.buildEngineStateMock.mockReset();
    mocks.applyEngineStatePatchMock.mockReset();
    mocks.applyEngineStatePatchMock.mockReturnValue(true);
    mocks.initializeStoreMock.mockReset();
    mocks.getCoreSettingsServiceMock.mockReset();
    mocks.listContributionsMock.mockReset();
    mocks.subscribeContributionsMock.mockReset();
    mocks.onSettingsInitializedMock.mockReset();
    mocks.getCoreSettingsServiceMock.mockReturnValue(null);
    mocks.subscribeContributionsMock.mockReturnValue(() => {});
    mocks.onSettingsInitializedMock.mockReturnValue(() => {});
    mocks.executeQueryForFlowMock.mockResolvedValue({ rowsAffected: 1, rows: [{ ok: true }], preview: "select 1" });
    clearFlowNodeTypeContributionsForTests();
  });

  it("contributes Payloadbuilder flow query node type", () => {
    mocks.listContributionsMock.mockReturnValue([{
      catalogId: "elasticsearch",
      title: "Elasticsearch",
      defaultAlias: "es",
      allowMultiple: true,
      flowMappingFields: [
        { id: "connectionId", label: "Connection", kind: "select", required: true, listOptions: () => ["cluster1"] },
        { id: "index", label: "Index", kind: "text", required: true }
      ]
    }]);
    mocks.getCoreSettingsServiceMock.mockReturnValue({
      getValue: vi.fn(() => undefined),
      refreshSchemaFromRegistry: vi.fn(),
      syncRegistryModules: vi.fn(async () => {}),
      setValue: vi.fn(async () => ({ ok: true }))
    });

    coreQueryEnginePayloadbuilderPlugin.activate(createContext());

    const contribution = getFlowNodeTypeContribution("payloadbuilder.query");
    expect(contribution?.title).toBe("Payloadbuilder Query");
    expect(contribution?.getSummary?.({
      node: {
        index: 0,
        action: "select 1",
        range: { metadataStartLine: 1, metadataEndLine: 4, actionStartLine: 5, actionEndLine: 5 },
        metadata: {
          id: "search",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "search",
              catalogs: {
                search: { provider: "elasticsearch" }
              }
            }
          }
        }
      }
    })).toEqual([
      { label: "Catalog", value: "search" },
      { label: "Provider", value: "Elasticsearch" }
    ]);
    expect(contribution?.validateConfiguration?.({
      node: {
        index: 0,
        action: "select 1",
        range: { metadataStartLine: 1, metadataEndLine: 4, actionStartLine: 5, actionEndLine: 5 },
        metadata: {
          id: "search",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "search",
              catalogs: {
                search: {}
              }
            }
          }
        }
      }
    })).toEqual([
      { field: "payloadbuilder.catalogs.search.provider", message: "Provider is required." }
    ]);
  });

  it("resolves persisted connection label to runtime connection id in flow execute", async () => {
    mocks.listContributionsMock.mockReturnValue([
      {
        catalogId: "elasticsearch",
        title: "Elasticsearch",
        defaultAlias: "es",
        allowMultiple: true,
        flowMappingFields: [
          {
            id: "connectionId",
            label: "Connection",
            kind: "select",
            required: true,
            persistAsLabel: true,
            mappingKind: "elasticsearch.connection",
            listOptions: () => [{ value: "uuid-1", label: "Cluster One" }]
          },
          { id: "index", label: "Index", kind: "text", required: true }
        ]
      }
    ]);

    coreQueryEnginePayloadbuilderPlugin.activate(createContext());

    const contribution = getFlowNodeTypeContribution("payloadbuilder.query");
    expect(contribution).toBeDefined();

    const result = await contribution?.execute({
      fileId: "file-1",
      action: "select * from search._doc",
      ctx: {},
      node: {
        index: 0,
        action: "select * from search._doc",
        range: { metadataStartLine: 1, metadataEndLine: 7, actionStartLine: 8, actionEndLine: 8 },
        metadata: {
          id: "search-orders",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "search",
              catalogs: {
                search: {
                  provider: "elasticsearch",
                  connectionId: "Cluster One",
                  index: "orders-*"
                }
              }
            }
          }
        }
      }
    });

    expect(result).toEqual({ ok: true, output: { rowsAffected: 1, rows: [{ ok: true }], preview: "select 1" } });
    expect(mocks.executeQueryForFlowMock).toHaveBeenCalledWith({
      engineId: "payloadbuilder",
      fileId: "file-1",
      text: "select * from search._doc",
      engineState: {
        payloadbuilder: {
          defaultCatalogAlias: "search",
          catalogs: {
            search: {
              catalogId: "elasticsearch",
              properties: {
                connectionId: "uuid-1",
                index: "orders-*"
              }
            }
          }
        }
      }
    });
  });

  it("resolves portable connection ref through core.flow local mapping", async () => {
    mocks.listContributionsMock.mockReturnValue([
      {
        catalogId: "elasticsearch",
        title: "Elasticsearch",
        defaultAlias: "es",
        allowMultiple: true,
        flowMappingFields: [
          {
            id: "connectionId",
            label: "Connection",
            kind: "select",
            required: true,
            persistAsLabel: true,
            mappingKind: "elasticsearch.connection",
            listOptions: () => [{ value: "uuid-1", label: "Cluster One" }]
          }
        ]
      }
    ]);
    mocks.getCoreSettingsServiceMock.mockReturnValue({
      getValue: vi.fn((settingId: string) => settingId === "core.flow.environments"
        ? {
            activeEnvironment: "dev",
            environments: ["dev"],
            mappings: [{
              environment: "dev",
              owner: "core.queryengine.payloadbuilder",
              kind: "elasticsearch.connection",
              ref: "someConnection",
              value: "uuid-1"
            }]
          }
        : undefined),
      refreshSchemaFromRegistry: vi.fn(),
      syncRegistryModules: vi.fn(async () => {}),
      setValue: vi.fn(async () => ({ ok: true }))
    });

    coreQueryEnginePayloadbuilderPlugin.activate(createContext());

    const contribution = getFlowNodeTypeContribution("payloadbuilder.query");
    const result = await contribution?.execute({
      fileId: "file-1",
      action: "select * from search._doc",
      ctx: {},
      node: {
        index: 0,
        action: "select * from search._doc",
        range: { metadataStartLine: 1, metadataEndLine: 7, actionStartLine: 8, actionEndLine: 8 },
        metadata: {
          id: "search-orders",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "search",
              catalogs: {
                search: {
                  provider: "elasticsearch",
                  connectionId: "someConnection"
                }
              }
            }
          }
        }
      }
    });

    expect(result?.ok).toBe(true);
    expect(mocks.executeQueryForFlowMock).toHaveBeenCalledWith(expect.objectContaining({
      engineState: {
        payloadbuilder: {
          defaultCatalogAlias: "search",
          catalogs: {
            search: {
              catalogId: "elasticsearch",
              properties: {
                connectionId: "uuid-1"
              }
            }
          }
        }
      }
    }));

    expect(contribution?.getCodeLens?.({
      node: {
        index: 0,
        action: "select * from search._doc",
        range: { metadataStartLine: 1, metadataEndLine: 7, actionStartLine: 8, actionEndLine: 8 },
        metadata: {
          id: "search-orders",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "search",
              catalogs: {
                search: {
                  provider: "elasticsearch",
                  connectionId: "someConnection"
                }
              }
            }
          }
        }
      }
    })).toEqual([{ title: "🔗 Uses local mapping => Cluster One", commandId: "core.flow.configureNodeAtCursor", arguments: ["search-orders"] }]);
  });

  it("resolves multiple payloadbuilder catalogs from flow metadata", async () => {
    mocks.listContributionsMock.mockReturnValue([
      {
        catalogId: "elasticsearch",
        title: "Elasticsearch",
        defaultAlias: "es",
        allowMultiple: true,
        flowMappingFields: [
          {
            id: "connectionId",
            label: "Connection",
            kind: "select",
            required: true,
            persistAsLabel: true,
            mappingKind: "elasticsearch.connection",
            listOptions: () => [{ value: "es-uuid", label: "Search Prod" }]
          },
          { id: "index", label: "Index", kind: "text", required: true }
        ]
      },
      {
        catalogId: "jdbc",
        title: "JDBC",
        defaultAlias: "jdbc",
        allowMultiple: true,
        flowMappingFields: [
          {
            id: "connectionId",
            label: "Connection",
            kind: "select",
            required: true,
            persistAsLabel: true,
            mappingKind: "jdbc.connection",
            listOptions: () => [{ value: "jdbc-uuid", label: "Reporting DB" }]
          }
        ]
      }
    ]);
    mocks.getCoreSettingsServiceMock.mockReturnValue({
      getValue: vi.fn((settingId: string) => settingId === "core.flow.environments"
        ? {
            activeEnvironment: "dev",
            environments: ["dev"],
            mappings: [
              {
                environment: "dev",
                owner: "core.queryengine.payloadbuilder",
                kind: "elasticsearch.connection",
                ref: "search-prod",
                value: "es-uuid"
              },
              {
                environment: "dev",
                owner: "core.queryengine.payloadbuilder",
                kind: "jdbc.connection",
                ref: "reporting-db",
                value: "jdbc-uuid"
              }
            ]
          }
        : undefined),
      refreshSchemaFromRegistry: vi.fn(),
      syncRegistryModules: vi.fn(async () => {}),
      setValue: vi.fn(async () => ({ ok: true }))
    });

    coreQueryEnginePayloadbuilderPlugin.activate(createContext());

    const action = [
      "select top 10 *",
      "from es#_doc d",
      "inner join jdbc#some.table t",
      "  on t.id = d.id"
    ].join("\n");
    const contribution = getFlowNodeTypeContribution("payloadbuilder.query");
    const result = await contribution?.execute({
      fileId: "file-1",
      action,
      ctx: {},
      node: {
        index: 0,
        action,
        range: { metadataStartLine: 1, metadataEndLine: 13, actionStartLine: 14, actionEndLine: 17 },
        metadata: {
          id: "join-catalogs",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "es",
              catalogs: {
                es: {
                  provider: "elasticsearch",
                  connectionId: "search-prod",
                  index: "my-index"
                },
                jdbc: {
                  provider: "jdbc",
                  connectionId: "reporting-db"
                }
              }
            }
          }
        }
      }
    });

    expect(result?.ok).toBe(true);
    expect(mocks.executeQueryForFlowMock).toHaveBeenCalledWith({
      engineId: "payloadbuilder",
      fileId: "file-1",
      text: action,
      engineState: {
        payloadbuilder: {
          defaultCatalogAlias: "es",
          catalogs: {
            es: {
              catalogId: "elasticsearch",
              properties: {
                connectionId: "es-uuid",
                index: "my-index"
              }
            },
            jdbc: {
              catalogId: "jdbc",
              properties: {
                connectionId: "jdbc-uuid"
              }
            }
          }
        }
      }
    });

    expect(contribution?.getCodeLens?.({
      node: {
        index: 0,
        action,
        range: { metadataStartLine: 1, metadataEndLine: 13, actionStartLine: 14, actionEndLine: 17 },
        metadata: {
          id: "join-catalogs",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "es",
              catalogs: {
                es: {
                  provider: "elasticsearch",
                  connectionId: "search-prod",
                  index: "my-index"
                },
                jdbc: {
                  provider: "jdbc",
                  connectionId: "reporting-db"
                }
              }
            }
          }
        }
      }
    })).toEqual([{ title: "🔗 Uses 2 local mappings => Search Prod, Reporting DB", commandId: "core.flow.configureNodeAtCursor", arguments: ["join-catalogs"] }]);
  });

  it("prefers explicit local mapping over direct label match", async () => {
    mocks.listContributionsMock.mockReturnValue([
      {
        catalogId: "elasticsearch",
        title: "Elasticsearch",
        defaultAlias: "es",
        allowMultiple: true,
        flowMappingFields: [
          {
            id: "connectionId",
            label: "Connection",
            kind: "select",
            required: true,
            persistAsLabel: true,
            mappingKind: "elasticsearch.connection",
            listOptions: () => [
              { value: "uuid-1", label: "Cluster One" },
              { value: "uuid-2", label: "Cluster Two" }
            ]
          }
        ]
      }
    ]);
    mocks.getCoreSettingsServiceMock.mockReturnValue({
      getValue: vi.fn((settingId: string) => settingId === "core.flow.environments"
        ? {
            activeEnvironment: "dev",
            environments: ["dev"],
            mappings: [{
              environment: "dev",
              owner: "core.queryengine.payloadbuilder",
              kind: "elasticsearch.connection",
              ref: "Cluster One",
              value: "uuid-2"
            }]
          }
        : undefined),
      refreshSchemaFromRegistry: vi.fn(),
      syncRegistryModules: vi.fn(async () => {}),
      setValue: vi.fn(async () => ({ ok: true }))
    });

    coreQueryEnginePayloadbuilderPlugin.activate(createContext());

    const contribution = getFlowNodeTypeContribution("payloadbuilder.query");
    const result = await contribution?.execute({
      fileId: "file-1",
      action: "select * from search._doc",
      ctx: {},
      node: {
        index: 0,
        action: "select * from search._doc",
        range: { metadataStartLine: 1, metadataEndLine: 7, actionStartLine: 8, actionEndLine: 8 },
        metadata: {
          id: "search-orders",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "search",
              catalogs: {
                search: {
                  provider: "elasticsearch",
                  connectionId: "Cluster One"
                }
              }
            }
          }
        }
      }
    });

    expect(result?.ok).toBe(true);
    expect(mocks.executeQueryForFlowMock).toHaveBeenCalledWith(expect.objectContaining({
      engineState: {
        payloadbuilder: {
          defaultCatalogAlias: "search",
          catalogs: {
            search: {
              catalogId: "elasticsearch",
              properties: {
                connectionId: "uuid-2"
              }
            }
          }
        }
      }
    }));

    expect(contribution?.getCodeLens?.({
      node: {
        index: 0,
        action: "select * from search._doc",
        range: { metadataStartLine: 1, metadataEndLine: 7, actionStartLine: 8, actionEndLine: 8 },
        metadata: {
          id: "search-orders",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "search",
              catalogs: {
                search: {
                  provider: "elasticsearch",
                  connectionId: "Cluster One"
                }
              }
            }
          }
        }
      }
    })).toEqual([{ title: "🔗 Uses local mapping => Cluster Two", commandId: "core.flow.configureNodeAtCursor", arguments: ["search-orders"] }]);
  });

  it("returns configuration error when persisted label has no local mapping", async () => {
    mocks.listContributionsMock.mockReturnValue([
      {
        catalogId: "elasticsearch",
        title: "Elasticsearch",
        defaultAlias: "es",
        allowMultiple: true,
        flowMappingFields: [
          {
            id: "connectionId",
            label: "Connection",
            kind: "select",
            required: true,
            persistAsLabel: true,
            mappingKind: "elasticsearch.connection",
            listOptions: () => [{ value: "uuid-2", label: "Cluster Two" }]
          },
          { id: "index", label: "Index", kind: "text", required: true }
        ]
      }
    ]);

    coreQueryEnginePayloadbuilderPlugin.activate(createContext());

    const contribution = getFlowNodeTypeContribution("payloadbuilder.query");
    expect(contribution).toBeDefined();

    const result = await contribution?.execute({
      fileId: "file-1",
      action: "select * from search._doc",
      ctx: {},
      node: {
        index: 0,
        action: "select * from search._doc",
        range: { metadataStartLine: 1, metadataEndLine: 7, actionStartLine: 8, actionEndLine: 8 },
        metadata: {
          id: "search-orders",
          type: "payloadbuilder.query",
          additional: {
            payloadbuilder: {
              defaultCatalogAlias: "search",
              catalogs: {
                search: {
                  provider: "elasticsearch",
                  connectionId: "Cluster One",
                  index: "orders-*"
                }
              }
            }
          }
        }
      }
    });

    expect(result).toEqual({
      ok: false,
      code: "FLOW_MAPPING_MISSING",
      message: "Payloadbuilder flow mapping 'connectionId' value 'Cluster One' is not mapped locally.",
      details: {
        owner: "core.queryengine.payloadbuilder",
        kind: "elasticsearch.connection",
        ref: "Cluster One",
        field: "connectionId",
        alias: "search"
      }
    });
    expect(mocks.executeQueryForFlowMock).not.toHaveBeenCalled();
  });

  it("wires payloadbuilder engineState into execute context", () => {
    const context = createContext();
    mocks.buildEngineStateMock.mockReturnValue({ payloadbuilder: { catalogs: { jdbc1: {} } } });

    coreQueryEnginePayloadbuilderPlugin.activate(context);

    const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]?.[0] as
      | ((params: { engineId: string; text: string; fileId?: string }) => unknown)
      | undefined;
    expect(provider).toBeTypeOf("function");

    const payloadbuilderPatch = provider?.({
      engineId: "payloadbuilder",
      text: "select 1",
      fileId: "file-1"
    });

    expect(mocks.buildEngineStateMock).toHaveBeenCalledWith("file-1");
    expect(payloadbuilderPatch).toEqual({
      engineState: { payloadbuilder: { catalogs: { jdbc1: {} } } }
    });

    const otherEnginePatch = provider?.({
      engineId: "jdbc",
      text: "select 1",
      fileId: "file-1"
    });

    expect(otherEnginePatch).toBeUndefined();
    expect(mocks.buildEngineStateMock).toHaveBeenCalledTimes(1);
  });

  it("registers payloadbuilder sidebar view with plbsql mime condition", () => {
    const context = createContext();

    coreQueryEnginePayloadbuilderPlugin.activate(context);

    expect(mocks.registerEngineResolverMock).toHaveBeenCalledTimes(1);

    expect(context.files.capabilities.registerCapabilities).toHaveBeenCalledWith(
      "application/plbsql",
      ["queryexecutable"]
    );

    const registerViewMock = context.layout.registerView as ReturnType<typeof vi.fn>;
    expect(registerViewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.payloadbuilder.catalogs",
        when: "activeFile?.mimeType == 'application/plbsql'"
      })
    );
  });

  it("applies completed engineState back into store for payloadbuilder", () => {
    const context = createContext();
    coreQueryEnginePayloadbuilderPlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((
          event: { method: string; params?: { engineState?: unknown } },
          executeContext?: { engineId?: string; fileId?: string }
        ) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      {
        method: "queryengine.completed",
        params: {
          engineState: {
            payloadbuilder: {
              catalogs: {
                jdbc1: {
                  properties: {
                    database: "reporting"
                  }
                }
              }
            }
          }
        }
      },
      { engineId: "payloadbuilder", fileId: "file-1" }
    );

    expect(mocks.applyEngineStatePatchMock).toHaveBeenCalledWith(
      "file-1",
      {
        payloadbuilder: {
          catalogs: {
            jdbc1: {
              properties: {
                database: "reporting"
              }
            }
          }
        }
      },
      undefined
    );

    listener?.(
      { method: "queryengine.completed", params: { engineState: { ignored: true } } },
      { engineId: "jdbc", fileId: "file-1" }
    );
    listener?.({ method: "queryengine.completed", params: {} }, { engineId: "payloadbuilder", fileId: "file-1" });
    listener?.(
      { method: "queryengine.completed", params: { engineState: { ignored: true } } },
      { engineId: "payloadbuilder" }
    );
    listener?.(
      { method: "queryengine.failed", params: { engineState: { ignored: true } } },
      { engineId: "payloadbuilder", fileId: "file-1" }
    );

    expect(mocks.applyEngineStatePatchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores completed payloadbuilder engineState for non-plbsql files", () => {
    const context = createContext();
    coreQueryEnginePayloadbuilderPlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((
          event: { method: string; params?: { engineState?: unknown } },
          executeContext?: { engineId?: string; fileId?: string }
        ) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      {
        method: "queryengine.completed",
        params: {
          engineState: {
            payloadbuilder: {
              catalogs: {
                jdbc1: {
                  properties: {
                    database: "reporting"
                  }
                }
              }
            }
          }
        }
      },
      { engineId: "payloadbuilder", fileId: "file-sql" }
    );

    expect(mocks.applyEngineStatePatchMock).not.toHaveBeenCalled();
  });

  it("updates sessionId metadata on completed payloadbuilder event", () => {
    const context = createContext();
    coreQueryEnginePayloadbuilderPlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((
          event: { method: string; params?: { engineState?: unknown } },
          executeContext?: { engineId?: string; fileId?: string }
        ) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    const updateFileMock = context.files.updateFile as ReturnType<typeof vi.fn>;
    updateFileMock.mockClear();

    listener?.(
      {
        method: "queryengine.completed",
        params: {
          engineState: {
            payloadbuilder: {
              sessionId: "1"
            }
          }
        }
      },
      { engineId: "payloadbuilder", fileId: "file-1" }
    );

    expect(updateFileMock).toHaveBeenCalledWith(
      "file-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          "core.queryengine.payloadbuilder.sessionId": "1"
        })
      })
    );
  });

  it("does not apply stale session metadata when the catalog patch is rejected", () => {
    const context = createContext();
    mocks.applyEngineStatePatchMock.mockReturnValue(false);
    coreQueryEnginePayloadbuilderPlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((
          event: { method: string; params?: { engineState?: unknown } },
          executeContext?: { engineId?: string; fileId?: string; engineState?: unknown }
        ) => void)
      | undefined;
    const submittedEngineState = {
      payloadbuilder: {
        catalogs: { jdbc1: { catalogId: "Jdbc", properties: { connectionId: "first" } } }
      }
    };
    const updateFileMock = context.files.updateFile as ReturnType<typeof vi.fn>;
    updateFileMock.mockClear();

    listener?.(
      {
        method: "queryengine.completed",
        params: { engineState: { payloadbuilder: { sessionId: "old-session" } } }
      },
      { engineId: "payloadbuilder", fileId: "file-1", engineState: submittedEngineState }
    );

    expect(mocks.applyEngineStatePatchMock).toHaveBeenCalledWith(
      "file-1",
      { payloadbuilder: { sessionId: "old-session" } },
      submittedEngineState
    );
    expect(updateFileMock).not.toHaveBeenCalled();
  });

  it("adapts catalog instance setting with newly contributed catalogs", async () => {
    const context = createContext();
    const setValueMock = vi.fn(async () => ({ ok: true }));
    mocks.listContributionsMock.mockReturnValue([
      {
        catalogId: "filesystem",
        title: "Filesystem",
        defaultAlias: "fs",
        allowMultiple: false
      },
      {
        catalogId: "http",
        title: "HTTP",
        defaultAlias: "http",
        allowMultiple: false
      }
    ]);
    mocks.getCoreSettingsServiceMock.mockReturnValue({
      refreshSchemaFromRegistry: vi.fn(),
      syncRegistryModules: vi.fn(async () => {}),
      getValue: vi.fn(() => []),
      setValue: setValueMock
    });

    coreQueryEnginePayloadbuilderPlugin.activate(context);
    await Promise.resolve();

    expect(setValueMock).toHaveBeenCalledWith(
      "core.queryengine.payloadbuilder.catalogInstances",
      [
        {
          alias: "fs",
          catalogId: "filesystem",
          title: "Filesystem",
          enabled: true
        },
        {
          alias: "http",
          catalogId: "http",
          title: "HTTP",
          enabled: true
        }
      ]
    );
  });

  it("adapts catalog setting when new contribution is registered after activation", async () => {
    const context = createContext();
    const setValueMock = vi.fn(async () => ({ ok: true }));
    let contributionListener: (() => void) | undefined;
    mocks.subscribeContributionsMock.mockImplementation((listener: () => void) => {
      contributionListener = listener;
      return () => {};
    });
    mocks.getCoreSettingsServiceMock.mockReturnValue({
      refreshSchemaFromRegistry: vi.fn(),
      syncRegistryModules: vi.fn(async () => {}),
      getValue: vi.fn(() => []),
      setValue: setValueMock
    });
    mocks.listContributionsMock.mockReturnValue([]);

    coreQueryEnginePayloadbuilderPlugin.activate(context);
    await Promise.resolve();

    mocks.listContributionsMock.mockReturnValue([
      {
        catalogId: "filesystem",
        title: "Filesystem",
        defaultAlias: "fs",
        allowMultiple: false
      },
      {
        catalogId: "http",
        title: "HTTP",
        defaultAlias: "http",
        allowMultiple: false
      }
    ]);
    contributionListener?.();
    await Promise.resolve();

    expect(setValueMock).toHaveBeenCalledWith(
      "core.queryengine.payloadbuilder.catalogInstances",
      [
        {
          alias: "fs",
          catalogId: "filesystem",
          title: "Filesystem",
          enabled: true
        },
        {
          alias: "http",
          catalogId: "http",
          title: "HTTP",
          enabled: true
        }
      ]
    );
  });
});
