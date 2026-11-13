import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";

const mocks = vi.hoisted(() => ({
  registerEngineResolverMock: vi.fn(),
  invokeMock: vi.fn(),
  registerExecutionContextProviderMock: vi.fn(),
  onQueryEventMock: vi.fn()
}));

vi.mock("./QueryEngineService", () => ({
  getQueryEngineService: () => ({
    registerEngineResolver: mocks.registerEngineResolverMock,
    invoke: mocks.invokeMock,
    registerExecutionContextProvider: mocks.registerExecutionContextProviderMock,
    onQueryEvent: mocks.onQueryEventMock
  })
}));

import { createNativeQueryEngineRegistry, registerQueryExecutableEngine } from "./engine-registration";
import { getQueryEditorHeaderItems } from "./query-editor-header-registry";
import { getQueryEditorStatusItems } from "./query-editor-status-registry";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    version: 1,
    uri: "file:///C:/tmp/a.plbsql",
    mimeType: "application/plbsql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString(),
    ...overrides
  };
}

function createContext(file: FileEntity): PluginContext {
  const filesById = new Map<string, FileEntity>([[file.fileId, file]]);
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
        registerCapabilities: vi.fn(() => ({ dispose: vi.fn() })),
        registerLabel: vi.fn(),
        registerPreferredNewFileMimeType: vi.fn(),
        listPreferredNewFileMimeTypes: vi.fn(() => []),
        getLabel: vi.fn(),
        hasCapability: vi.fn(() => false),
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
      updateFile: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      registerMimeResolver: vi.fn(),
      registerEditorResolver: vi.fn(),
      classifyUri: vi.fn(() => "application/plbsql"),
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
      getAdvancedValidator: vi.fn(),
      getValue: vi.fn(),
      getAllValues: vi.fn(() => ({})),
      subscribe: vi.fn(() => () => {}),
      open: vi.fn()
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
    components: { FrameworkEditor: vi.fn() as any, PasswordFieldInput: vi.fn() as any, CollectionSettingsListEditor: vi.fn() as any, useCollectionSettingsPersistence: vi.fn() as any },
    about: { registerChangelog: vi.fn() },
    notifications: createNotificationMock(),
    assistant: createAssistantRegistryMock(),
    queryEngines: {
      registerEngine: vi.fn(() => ({ dispose: vi.fn() })),
      invoke: vi.fn(),
      registerExecutionContextProvider: vi.fn(() => ({ dispose: vi.fn() })),
      onQueryEvent: vi.fn(() => ({ dispose: vi.fn() })),
      registerEditorHeaderItem: vi.fn(() => ({ dispose: vi.fn() })),
      registerEditorStatusItem: vi.fn(() => ({ dispose: vi.fn() }))
    },
    editorLanguages: { registerMimeType: vi.fn(() => ({ dispose: vi.fn() })) },
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

describe("registerQueryExecutableEngine", () => {
  beforeEach(() => {
    mocks.registerEngineResolverMock.mockReset();
    mocks.registerEngineResolverMock.mockReturnValue(() => {});
    mocks.invokeMock.mockReset();
    mocks.registerExecutionContextProviderMock.mockReset();
    mocks.registerExecutionContextProviderMock.mockReturnValue(vi.fn());
    mocks.onQueryEventMock.mockReset();
    mocks.onQueryEventMock.mockReturnValue(vi.fn());
  });

  it("registers capability and matching resolver together", () => {
    const context = createContext(makeFile());

    registerQueryExecutableEngine(context.files, {
      engineId: "payloadbuilder",
      mimeTypes: ["application/plbsql"]
    });

    expect(context.files.capabilities.registerCapabilities).toHaveBeenCalledWith(
      "application/plbsql",
      ["queryexecutable"]
    );
    expect(mocks.registerEngineResolverMock).toHaveBeenCalledTimes(1);

    const resolver = mocks.registerEngineResolverMock.mock.calls[0]?.[0] as
      | ((params: { fileId?: string }) => string | undefined)
      | undefined;
    expect(resolver).toBeTypeOf("function");
    expect(resolver?.({ fileId: "file-1" })).toBe("payloadbuilder");
    expect(resolver?.({ fileId: "missing" })).toBeUndefined();
  });

  it("delegates invoke and editor contribution registration through the host registry", async () => {
    const context = createContext(makeFile());
    const registry = createNativeQueryEngineRegistry(context.files);
    mocks.invokeMock.mockResolvedValue({ collections: ["orders"] });

    await expect(registry.invoke<{ collections: string[] }>({
      engineId: "mongodb",
      action: "mongodb.collections",
      payload: { database: "shop" }
    }, { silent: true })).resolves.toEqual({ collections: ["orders"] });
    expect(mocks.invokeMock).toHaveBeenCalledWith({
      engineId: "mongodb",
      action: "mongodb.collections",
      payload: { database: "shop" }
    }, { silent: true });

    const statusRegistration = registry.registerEditorStatusItem({
      id: "test.mongodb.status",
      order: 5,
      render: () => "MongoDB"
    });
    expect(getQueryEditorStatusItems().some((item) => item.id === "test.mongodb.status")).toBe(true);
    statusRegistration.dispose();
    expect(getQueryEditorStatusItems().some((item) => item.id === "test.mongodb.status")).toBe(false);

    const headerRegistration = registry.registerEditorHeaderItem({
      id: "test.mongodb.header",
      order: 5,
      render: () => "MongoDB query bar"
    });
    expect(getQueryEditorHeaderItems().some((item) => item.id === "test.mongodb.header")).toBe(true);
    headerRegistration.dispose();
    expect(getQueryEditorHeaderItems().some((item) => item.id === "test.mongodb.header")).toBe(false);
  });

  it("scopes execution context providers and query events to their engine", () => {
    const registry = createNativeQueryEngineRegistry(createContext(makeFile()).files);
    const provider = vi.fn(() => ({
      engineState: { database: "shop" },
      options: { intent: "plan.actual" as const }
    }));
    const listener = vi.fn();

    const providerRegistration = registry.registerExecutionContextProvider("mongodb", provider);
    const eventRegistration = registry.onQueryEvent("mongodb", listener);
    const hostProvider = mocks.registerExecutionContextProviderMock.mock.calls[0]?.[0] as
      (params: { engineId?: string; text: string; fileId: string }) => unknown;
    const hostListener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      (event: { method: string; params: unknown }, context?: { engineId?: string; text: string; fileId: string }) => void;

    expect(hostProvider({ engineId: "jdbc", text: "select 1", fileId: "file-1" })).toBeUndefined();
    expect(provider).not.toHaveBeenCalled();
    expect(hostProvider({ engineId: "mongodb", text: "db.orders.find()", fileId: "file-1" }))
      .toEqual({
        engineState: { database: "shop" },
        options: { intent: "plan.actual" }
      });

    hostListener({ method: "queryengine.completed", params: { engineState: { database: "shop" } } }, {
      engineId: "jdbc",
      text: "select 1",
      fileId: "file-1"
    });
    expect(listener).not.toHaveBeenCalled();
    hostListener({ method: "queryengine.completed", params: { engineState: { database: "shop" } } }, {
      engineId: "mongodb",
      text: "db.orders.find()",
      fileId: "file-1"
    });
    expect(listener).toHaveBeenCalledOnce();

    providerRegistration.dispose();
    eventRegistration.dispose();
    expect(mocks.registerExecutionContextProviderMock.mock.results[0]?.value).toHaveBeenCalledOnce();
    expect(mocks.onQueryEventMock.mock.results[0]?.value).toHaveBeenCalledOnce();
  });

  it("returns an engine registration disposable", () => {
    const unregister = vi.fn();
    const disposeCapability = vi.fn();
    mocks.registerEngineResolverMock.mockReturnValueOnce(unregister);
    const context = createContext(makeFile());
    vi.mocked(context.files.capabilities.registerCapabilities).mockReturnValue({ dispose: disposeCapability });
    const registry = createNativeQueryEngineRegistry(context.files);

    const registration = registry.registerEngine({ engineId: "mongodb", mimeTypes: ["application/mongodb"] });
    registration.dispose();

    expect(unregister).toHaveBeenCalledOnce();
    expect(disposeCapability).toHaveBeenCalledOnce();
  });
});
