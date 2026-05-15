import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../../contracts/plugin/Plugin";

const mocks = vi.hoisted(() => ({
  registerExecutionContextProviderMock: vi.fn(),
  registerEngineResolverMock: vi.fn(),
  onQueryEventMock: vi.fn(),
  invokeMock: vi.fn(async (): Promise<unknown> => []),
  getConfiguredJdbcConnectionsMock: vi.fn<() => unknown[]>(() => []),
  loadConnectionRootsMock: vi.fn(),
  openQuickCommandMock: vi.fn()
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({
    registerExecutionContextProvider: mocks.registerExecutionContextProviderMock,
    registerEngineResolver: mocks.registerEngineResolverMock,
    onQueryEvent: mocks.onQueryEventMock,
    invoke: mocks.invokeMock
  })
}));

vi.mock("./jdbc-navigation-store", () => ({
  getJdbcNavigationStore: () => ({
    loadConnectionRoots: mocks.loadConnectionRootsMock
  })
}));

vi.mock("./jdbc-settings", () => ({
  getConfiguredJdbcConnections: mocks.getConfiguredJdbcConnectionsMock,
  parseJdbcConnectionDefinitions: vi.fn((v: unknown[]) => v),
  JDBC_CONNECTIONS_SETTING_ID: "core.queryengine.jdbc.connections"
}));

vi.mock("../core.quickcommand/service", () => ({
  getQuickCommandService: () => ({ open: mocks.openQuickCommandMock })
}));

import { coreQueryEngineJdbcPlugin } from "./plugin";

import type { FileEntity } from "../../contracts/files/FileEntity";

function createContext(): PluginContext {
  const filesById = new Map<string, FileEntity>([
    [
      "file-1",
      {
        fileId: "file-1",
        version: 1,
        uri: "file:///file-1.sql",
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
      getEditorState: vi.fn((fileId: string, key: string) => {
        const file = filesById.get(fileId);
        return file?.persistentViewState?.[key];
      }),
      setEditorState: vi.fn((fileId: string, key: string, value: unknown) => {
        const file = filesById.get(fileId);
        if (!file) return;
        file.persistentViewState = { ...(file.persistentViewState ?? {}), [key]: value };
      }),
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

describe("core.queryengine.jdbc plugin integration", () => {
  beforeEach(() => {
    mocks.registerExecutionContextProviderMock.mockReset();
    mocks.registerEngineResolverMock.mockReset();
    mocks.onQueryEventMock.mockReset();
    mocks.invokeMock.mockReset();
    mocks.invokeMock.mockResolvedValue([]);
    mocks.loadConnectionRootsMock.mockReset();
    mocks.getConfiguredJdbcConnectionsMock.mockReset();
  });

  it("wires JDBC engineState with connectionId and database into execute context", () => {
    const context = createContext();
    const file = context.files.getFile("file-1");
    if (file) {
      file.engineBinding = { engineId: "jdbc", connectionId: "conn-a" };
      file.persistentViewState = {
        "jdbc.navigation.selectedDatabase": { connectionId: "conn-a", database: "reporting" }
      };
    }

    coreQueryEngineJdbcPlugin.activate(context);

    const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]?.[0] as
      | ((params: { engineId: string; text: string; fileId?: string }) => unknown)
      | undefined;
    expect(provider).toBeTypeOf("function");

    const patch = provider?.({ engineId: "jdbc", text: "select 1", fileId: "file-1" });
    expect(patch).toEqual({
      engineState: { connectionId: "conn-a", database: "reporting" }
    });

    const otherEnginePatch = provider?.({ engineId: "payloadbuilder", text: "select 1", fileId: "file-1" });
    expect(otherEnginePatch).toBeUndefined();
  });

  it("includes sessionId from runtime metadata in JDBC engineState", () => {
    const context = createContext();
    const file = context.files.getFile("file-1");
    if (file) {
      file.engineBinding = { engineId: "jdbc", connectionId: "conn-a" };
      file.metadata = {
        "core.queryengine.jdbc.sessionId": "s-99"
      };
    }

    coreQueryEngineJdbcPlugin.activate(context);

    // Populate sessionConnectionUuidMap by simulating a completed query event
    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((
          event: { method: string; params?: { engineState?: unknown } },
          executeContext?: { engineId?: string; fileId?: string }
        ) => void)
      | undefined;
    listener?.(
      { method: "queryengine.completed", params: { engineState: { sessionId: "s-99" } } },
      { engineId: "jdbc", fileId: "file-1" }
    );

    const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]?.[0] as
      | ((params: { engineId: string; text: string; fileId?: string }) => unknown)
      | undefined;

    const patch = provider?.({ engineId: "jdbc", text: "select 1", fileId: "file-1" });
    expect(patch).toEqual({
      engineState: { connectionId: "conn-a", sessionId: "s-99" }
    });
  });

  it("does not include sessionId when it belongs to another connection", () => {
    const context = createContext();
    const file = context.files.getFile("file-1");
    if (file) {
      file.engineBinding = { engineId: "jdbc", connectionId: "conn-b" };
      file.metadata = {
        "core.queryengine.jdbc.sessionId": "s-99",
        "core.queryengine.jdbc.sessionConnectionId": "conn-a"
      };
    }

    coreQueryEngineJdbcPlugin.activate(context);

    const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]?.[0] as
      | ((params: { engineId: string; text: string; fileId?: string }) => unknown)
      | undefined;

    const patch = provider?.({ engineId: "jdbc", text: "select 1", fileId: "file-1" });
    expect(patch).toEqual({
      engineState: { connectionId: "conn-b" }
    });
  });

  it("wires JDBC engineState with only connectionId when no database selected", () => {
    const context = createContext();
    const file = context.files.getFile("file-1");
    if (file) {
      file.engineBinding = { engineId: "jdbc", connectionId: "conn-b" };
    }

    coreQueryEngineJdbcPlugin.activate(context);

    const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]?.[0] as
      | ((params: { engineId: string; text: string; fileId?: string }) => unknown)
      | undefined;
    expect(provider).toBeTypeOf("function");

    const patch = provider?.({ engineId: "jdbc", text: "select 1", fileId: "file-1" });
    expect(patch).toEqual({
      engineState: { connectionId: "conn-b" }
    });
  });

  it("does not include database when persisted selection belongs to another connection", () => {
    const context = createContext();
    const file = context.files.getFile("file-1");
    if (file) {
      file.engineBinding = { engineId: "jdbc", connectionId: "conn-b" };
      file.persistentViewState = {
        "jdbc.navigation.selectedDatabase": { connectionId: "conn-a", database: "reporting" }
      };
    }

    coreQueryEngineJdbcPlugin.activate(context);

    const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]?.[0] as
      | ((params: { engineId: string; text: string; fileId?: string }) => unknown)
      | undefined;
    expect(provider).toBeTypeOf("function");

    const patch = provider?.({ engineId: "jdbc", text: "select 1", fileId: "file-1" });
    expect(patch).toEqual({
      engineState: { connectionId: "conn-b" }
    });
  });

  it("applies completed engineState database back into editor state", () => {
    const context = createContext();
    const file = context.files.getFile("file-1");
    if (file) {
      file.engineBinding = { engineId: "jdbc", connectionId: "conn-a" };
      file.persistentViewState = {
        "jdbc.navigation.selectedDatabase": { connectionId: "conn-a", database: "olddb" }
      };
    }

    coreQueryEngineJdbcPlugin.activate(context);

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
          engineState: { database: "newdb" }
        }
      },
      { engineId: "jdbc", fileId: "file-1" }
    );

    expect(context.files.setEditorState).toHaveBeenCalledWith(
      "file-1",
      "jdbc.navigation.selectedDatabase",
      { connectionId: "conn-a", database: "newdb" }
    );

    // Non-jdbc events should be ignored
    listener?.(
      { method: "queryengine.completed", params: { engineState: { database: "ignored" } } },
      { engineId: "payloadbuilder", fileId: "file-1" }
    );
    listener?.(
      { method: "queryengine.completed", params: {} },
      { engineId: "jdbc", fileId: "file-1" }
    );
    listener?.(
      { method: "queryengine.failed", params: { engineState: { database: "ignored" } } },
      { engineId: "jdbc", fileId: "file-1" }
    );

    expect(context.files.setEditorState).toHaveBeenCalledTimes(1);
  });

  it("applies completed engineState sessionId into runtime metadata", () => {
    const context = createContext();
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([
      { connectionId: "conn-a", title: "My Connection", enabled: true }
    ]);
    const file = context.files.getFile("file-1");
    if (file) {
      file.engineBinding = { engineId: "jdbc", connectionId: "conn-a" };
    }

    coreQueryEngineJdbcPlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((
          event: { method: string; params?: { engineState?: unknown } },
          executeContext?: { engineId?: string; fileId?: string }
        ) => void)
      | undefined;

    listener?.(
      {
        method: "queryengine.completed",
        params: {
          engineState: { sessionId: "session-1" }
        }
      },
      { engineId: "jdbc", fileId: "file-1" }
    );

    const updated = context.files.getFile("file-1");
    expect(updated?.metadata?.["core.queryengine.jdbc.sessionId"]).toBe("session-1");
    expect(updated?.metadata?.["core.queryengine.jdbc.sessionConnection"]).toBe("My Connection");
  });

  it("registers a quick command provider with $ prefix", () => {
    const context = createContext();
    coreQueryEngineJdbcPlugin.activate(context);

    const registerProviderMock = context.quickcommand.registerProvider as ReturnType<typeof vi.fn>;
    const provider = registerProviderMock.mock.calls[0]?.[0];
    expect(provider).toBeDefined();
    expect(provider.prefix).toBe("$");
    expect(provider.label).toBe("Select Database");
    expect(provider.order).toBe(15);
    expect(provider.when).toBe("activeFile.mimeType == 'application/sql'");
    expect(typeof provider.getItems).toBe("function");
  });

  it("registers F2 keybinding to open the database quick command", () => {
    const context = createContext();
    coreQueryEngineJdbcPlugin.activate(context);

    const registerCommandMock = context.commands.registerCommand as ReturnType<typeof vi.fn>;
    const commandCall = registerCommandMock.mock.calls.find(
      (call: unknown[]) => (call[0] as { id?: string } | undefined)?.id === "core.quickcommand.open.jdbc.databases"
    );
    expect(commandCall).toBeDefined();
    expect(commandCall![0].title).toBe("Select Database");
    expect(commandCall![0].category).toBe("Quick Command");
    expect(typeof commandCall![0].handler).toBe("function");

    const registerKeybindingMock = context.keybindings.registerKeybinding as ReturnType<typeof vi.fn>;
    const keybindingCall = registerKeybindingMock.mock.calls.find(
      (call: unknown[]) => (call[0] as { id?: string } | undefined)?.id === "core.quickcommand.open.jdbc.databases"
    );
    expect(keybindingCall).toBeDefined();
    expect(keybindingCall![0].commandId).toBe("core.quickcommand.open.jdbc.databases");
    expect(keybindingCall![0].key).toBe("F2");
    expect(keybindingCall![0].scope).toBe("global");
  });

  it("command handler passes when-expression to quick command service", () => {
    const context = createContext();
    coreQueryEngineJdbcPlugin.activate(context);

    const registerCommandMock = context.commands.registerCommand as ReturnType<typeof vi.fn>;
    const commandCall = registerCommandMock.mock.calls.find(
      (call: unknown[]) => (call[0] as { id?: string } | undefined)?.id === "core.quickcommand.open.jdbc.databases"
    );
    const handler = commandCall![0].handler as () => void;
    handler();

    expect(mocks.openQuickCommandMock).toHaveBeenCalledWith("$", { when: "activeFile.mimeType == 'application/sql'" });
  });

  it("registers SQL Server plan enablement with null-safe nested metadata access", () => {
    const context = createContext();
    coreQueryEngineJdbcPlugin.activate(context);

    const registerCommandMock = context.commands.registerCommand as ReturnType<typeof vi.fn>;
    const commandCall = registerCommandMock.mock.calls.find(
      (call: unknown[]) => (call[0] as { id?: string } | undefined)?.id === "core.queryengine.jdbc.sqlserver.toggleActualPlan"
    );
    expect(commandCall).toBeDefined();

    const enablement = commandCall![0].enablement as string;
    const evaluate = (activeFile: unknown) => {
      const runner = new Function("hasActiveQueryExecutableFile", "activeFile", `return (${enablement});`) as (hasActiveQueryExecutableFile: boolean, activeFile: unknown) => boolean;
      return runner(true, activeFile);
    };

    expect(evaluate({ metadata: {} })).toBe(false);
    expect(evaluate({ metadata: { core: { queryengine: { jdbc: { dialectId: "sqlserver" } } } } })).toBe(true);
  });

  it("applies connection color to tab header style for JDBC files", () => {
    const context = createContext();
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([
      { connectionId: "conn-a", dialectId: "postgres", url: "jdbc:postgresql://localhost/db", enabled: true, color: "#ff0000" }
    ]);

    coreQueryEngineJdbcPlugin.activate(context);

    const calls = (context.layout.registerTabHeaderStyle as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ id: string; render: (ctx: { file: FileEntity; isActive: boolean; hasCapability: (cap: string) => boolean }) => unknown }]>;
    const tabHeaderStyle = calls.find((call) => call[0].id === "core.queryengine.jdbc.tabHeaderStyle.connectionColor");
    expect(tabHeaderStyle).toBeDefined();

    const file = context.files.getFile("file-1")!;
    file.engineBinding = { engineId: "jdbc", connectionId: "conn-a" };

    const result = tabHeaderStyle![0].render({
      file,
      isActive: false,
      hasCapability: () => true
    });
    expect(result).toEqual({
      className: "tab-accent",
      style: { "--tab-accent-color": "#ff0000" }
    });
  });

  it("returns no tab style when JDBC file has no connection color", () => {
    const context = createContext();
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([
      { connectionId: "conn-a", dialectId: "postgres", url: "jdbc:postgresql://localhost/db", enabled: true }
    ]);

    coreQueryEngineJdbcPlugin.activate(context);

    const calls = (context.layout.registerTabHeaderStyle as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ id: string; render: (ctx: { file: FileEntity; isActive: boolean; hasCapability: (cap: string) => boolean }) => unknown }]>;
    const tabHeaderStyle = calls.find((call) => call[0].id === "core.queryengine.jdbc.tabHeaderStyle.connectionColor");
    expect(tabHeaderStyle).toBeDefined();

    const file = context.files.getFile("file-1")!;
    file.engineBinding = { engineId: "jdbc", connectionId: "conn-a" };

    const result = tabHeaderStyle![0].render({
      file,
      isActive: false,
      hasCapability: () => true
    });
    expect(result).toBeNull();
  });

  it("returns no tab style for non-JDBC files", () => {
    const context = createContext();
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([
      { connectionId: "conn-a", dialectId: "postgres", url: "jdbc:postgresql://localhost/db", enabled: true, color: "#ff0000" }
    ]);

    coreQueryEngineJdbcPlugin.activate(context);

    const calls = (context.layout.registerTabHeaderStyle as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ id: string; render: (ctx: { file: FileEntity; isActive: boolean; hasCapability: (cap: string) => boolean }) => unknown }]>;
    const tabHeaderStyle = calls.find((call) => call[0].id === "core.queryengine.jdbc.tabHeaderStyle.connectionColor");
    expect(tabHeaderStyle).toBeDefined();

    const file = context.files.getFile("file-1")!;
    file.engineBinding = { engineId: "payloadbuilder", connectionId: "conn-a" };

    const result = tabHeaderStyle![0].render({
      file,
      isActive: false,
      hasCapability: () => true
    });
    expect(result).toBeNull();
  });
});
