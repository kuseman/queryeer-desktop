import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import type { PayloadbuilderCatalogContribution } from "./catalog-contributions";

const mocks = vi.hoisted(() => ({
  registerExecutionContextProviderMock: vi.fn(),
  registerEngineResolverMock: vi.fn(),
  onQueryEventMock: vi.fn(),
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
  return {
    commands: {
      registerCommand: vi.fn(),
      executeCommand: vi.fn(async () => ({ commandId: "noop", executed: true })),
      canExecuteCommand: vi.fn(() => true)
    },
    filesystems: { registerFileSystem: vi.fn() },
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
      getFile: vi.fn(),
      listFiles: vi.fn(() => []),
      updateFile: vi.fn(),
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
    outline: {
      registerOutlineProvider: vi.fn(),
      registerSupplementaryOutlineProvider: vi.fn(),
      hasProvider: vi.fn(() => false),
      getProvider: vi.fn(),
      getSymbols: vi.fn()
    },
    editors: {
      getActiveEditor: vi.fn(() => null),
      onActiveEditorChanged: vi.fn(() => ({ dispose: vi.fn() }))
    }
  };
}

describe("core.queryengine.payloadbuilder plugin integration", () => {
  beforeEach(() => {
    mocks.registerExecutionContextProviderMock.mockReset();
    mocks.registerEngineResolverMock.mockReset();
    mocks.onQueryEventMock.mockReset();
    mocks.buildEngineStateMock.mockReset();
    mocks.applyEngineStatePatchMock.mockReset();
    mocks.initializeStoreMock.mockReset();
    mocks.getCoreSettingsServiceMock.mockReset();
    mocks.listContributionsMock.mockReset();
    mocks.subscribeContributionsMock.mockReset();
    mocks.onSettingsInitializedMock.mockReset();
    mocks.getCoreSettingsServiceMock.mockReturnValue(null);
    mocks.subscribeContributionsMock.mockReturnValue(() => {});
    mocks.onSettingsInitializedMock.mockReturnValue(() => {});
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
        when: "activeFileMimeType == 'application/plbsql'"
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

    expect(mocks.applyEngineStatePatchMock).toHaveBeenCalledWith("file-1", {
      payloadbuilder: {
        catalogs: {
          jdbc1: {
            properties: {
              database: "reporting"
            }
          }
        }
      }
    });

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

  it("adapts catalog instance setting with newly contributed catalogs", async () => {
    const context = createContext();
    const setValueMock = vi.fn(async () => ({ ok: true }));
    mocks.listContributionsMock.mockReturnValue([
      {
        catalogId: "filesystem",
        title: "Filesystem",
        defaultAlias: "fs",
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
        }
      ]
    );
  });
});
