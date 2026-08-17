import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import { createContextChain } from "../core.commands/context-chain";
import { setCommandContextChain } from "../core.commands/command-context-accessor";
import { ContextPriority } from "../core.commands/context-priority";

const settingsServiceMock = {
  getValue: vi.fn<(settingId: string) => unknown>(),
  setValue: vi.fn(async () => ({ ok: true })),
  refreshSchemaFromRegistry: vi.fn(),
  syncRegistryModules: vi.fn(async () => {})
};

vi.mock("../core.settings/service", () => ({
  getCoreSettingsService: () => settingsServiceMock,
  onCoreSettingsServiceInitialized: (_listener: (service: unknown) => void) => () => {}
}));

import { coreFilesPlugin } from "./plugin";

type Harness = {
  context: PluginContext;
  commands: Map<string, () => Promise<void> | void>;
  menuItems: Array<Record<string, unknown>>;
  toolbarActions: Array<Record<string, unknown>>;
  filesById: Map<string, FileEntity>;
  createUntitledFile: ReturnType<typeof vi.fn>;
};

function createHarness(): Harness {
  const commands = new Map<string, () => Promise<void> | void>();
  const menuItems: Array<Record<string, unknown>> = [];
  const toolbarActions: Array<Record<string, unknown>> = [];
  const filesById = new Map<string, FileEntity>();
  const createUntitledFile = vi.fn(async () => ({
    fileId: "new-file",
    version: 0,
    uri: "untitled:Untitled1.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync" as const,
    openedAt: new Date().toISOString()
  }));

  const context: PluginContext = {
    commands: {
      registerCommand: vi.fn((command) => {
        commands.set(command.id, command.handler);
      }),
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
        listPreferredNewFileMimeTypes: vi.fn(() => ["application/sql", "application/plbsql"]),
        getLabel: vi.fn((mimeType: string) => {
          if (mimeType === "application/sql") {
            return "Jdbc";
          }
          if (mimeType === "application/plbsql") {
            return "Payloadbuilder";
          }
          return undefined;
        }),
        hasCapability: vi.fn(() => true),
        listMimeTypesByCapability: vi.fn((capability) => {
          if (capability !== "creatable") {
            return [];
          }
          return ["application/sql", "application/plbsql", "application/json"];
        }),
        listAllMimeTypes: vi.fn(() => [
          "application/sql",
          "application/plbsql",
          "application/json"
        ]),
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
      classifyUri: vi.fn(() => "application/sql"),
      resolveEditor: vi.fn(),
      getEditorState: vi.fn(),
      setEditorState: vi.fn(),
      markDirty: vi.fn()
    },
    fileMediator: {
      openFile: vi.fn(),
      createUntitledFile,
      getUntitledCounter: vi.fn(() => 0),
      setUntitledCounter: vi.fn(),
      closeFile: vi.fn(),
      saveFile: vi.fn(),
      setActiveFileId: vi.fn(),
      getActiveFileId: vi.fn(() => "active-file"),
      onActiveFileChanged: vi.fn(() => () => {}),
      setContextFileId: vi.fn(),
      getContextFileId: vi.fn(() => null),
      bindEngine: vi.fn(),
      reloadFile: vi.fn(),
      acceptExternalChange: vi.fn(),
      discardExternalChange: vi.fn()
    },
    fileWatcher: {
      watch: vi.fn(),
      mutePath: vi.fn()
    },
    layout: {
      registerToolbarAction: vi.fn((contribution) => {
        toolbarActions.push(contribution as Record<string, unknown>);
      }),
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
      registerMenuItem: vi.fn((item) => {
        menuItems.push(item as Record<string, unknown>);
      }),
      rebuildMenu: vi.fn(async () => {}),
      onRebuild: vi.fn()
    },
    keybindings: { registerKeybinding: vi.fn() },
    dialog: {
      showMessage: vi.fn(async () => ({ action: "" })),
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showOpenFolder: vi.fn(async () => ({ canceled: true, folderPath: undefined })),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
      showInputDialog: vi.fn(async () => ({ canceled: true, value: undefined }))
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

  return {
    context,
    commands,
    menuItems,
    toolbarActions,
    filesById,
    createUntitledFile
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

describe("core.files plugin", () => {
  beforeEach(() => {
    setCommandContextChain(createContextChain());
    settingsServiceMock.getValue.mockReset();
    settingsServiceMock.setValue.mockClear();
    settingsServiceMock.refreshSchemaFromRegistry.mockClear();
    settingsServiceMock.syncRegistryModules.mockClear();
    settingsServiceMock.getValue.mockImplementation((settingId) => {
      if (settingId === "core.files.mimeTypes") {
        return [
          { mimeType: "application/plbsql", enableForNew: true },
          { mimeType: "application/sql", enableForNew: true }
        ];
      }
      return undefined;
    });
  });

  it("ctrl+n command clones active file state into Untitled<n>", async () => {
    const harness = createHarness();
    harness.filesById.set("active-file", {
      fileId: "active-file",
      version: 1,
      uri: "file:///some_query.plbsql",
      mimeType: "application/plbsql",
      engineBinding: { engineId: "payloadbuilder", connectionId: "pb-1" },
      persistentViewState: { "monaco.editor": { lineNumber: 3 } },
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync",
      openedAt: new Date().toISOString()
    });

    coreFilesPlugin.activate(harness.context);
    const handler = harness.commands.get("core.files.new");
    expect(handler).toBeTypeOf("function");

    await handler?.();

    expect(harness.createUntitledFile).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "application/plbsql",
        extension: "plbsql",
        cloneFromFileId: "active-file"
      })
    );
  });

  it("ctrl+n uses first configured mime type when active mime type is not configured", async () => {
    const harness = createHarness();
    harness.filesById.set("active-file", {
      fileId: "active-file",
      version: 1,
      uri: "file:///notes.txt",
      mimeType: "text/plain",
      engineBinding: { engineId: "payloadbuilder", connectionId: "pb-1" },
      persistentViewState: { "monaco.editor": { lineNumber: 3 } },
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync",
      openedAt: new Date().toISOString()
    });

    coreFilesPlugin.activate(harness.context);
    const handler = harness.commands.get("core.files.new");
    expect(handler).toBeTypeOf("function");

    await handler?.();

    expect(harness.createUntitledFile).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "application/plbsql",
        extension: "plbsql",
        cloneFromFileId: null
      })
    );
  });

  it("ctrl+n prefers command context active file over stale mediator active file", async () => {
    const harness = createHarness();
    harness.filesById.set("active-file", {
      fileId: "active-file",
      version: 1,
      uri: "file:///active.sql",
      mimeType: "application/sql",
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync",
      openedAt: new Date().toISOString()
    });
    harness.filesById.set("focused-file", {
      fileId: "focused-file",
      version: 1,
      uri: "file:///focused.plbsql",
      mimeType: "application/plbsql",
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync",
      openedAt: new Date().toISOString()
    });
    const chain = createContextChain();
    chain.register({
      id: "active-file",
      priority: ContextPriority.ACTIVE_FILE,
      context: { activeFileId: "focused-file" }
    });
    setCommandContextChain(chain);

    coreFilesPlugin.activate(harness.context);
    const handler = harness.commands.get("core.files.new");
    await handler?.();

    expect(harness.createUntitledFile).toHaveBeenCalledWith(
      expect.objectContaining({
        mimeType: "application/plbsql",
        extension: "plbsql",
        cloneFromFileId: "focused-file"
      })
    );
  });

  it("save command saves the active file", async () => {
    const harness = createHarness();

    coreFilesPlugin.activate(harness.context);
    const handler = harness.commands.get("core.files.save");
    await handler?.();

    expect(harness.context.fileMediator.saveFile).toHaveBeenCalledWith("active-file");
  });

  it("save command prefers the focused editor file over a stale mediator active file", async () => {
    const harness = createHarness();
    const chain = createContextChain();
    chain.register({
      id: "focused-editor",
      priority: ContextPriority.EDITOR_INSTANCE,
      context: {
        editorFocus: true,
        editorTextFocus: true,
        activeFileId: "focused-file"
      }
    });
    setCommandContextChain(chain);

    coreFilesPlugin.activate(harness.context);
    const handler = harness.commands.get("core.files.save");
    await handler?.();

    expect(harness.context.fileMediator.saveFile).toHaveBeenCalledWith("focused-file");
  });

  it("save command uses command context active file when editor focus has moved", async () => {
    const harness = createHarness();
    const chain = createContextChain();
    chain.register({
      id: "active-file",
      priority: ContextPriority.ACTIVE_FILE,
      context: { activeFileId: "context-active-file" }
    });
    setCommandContextChain(chain);

    coreFilesPlugin.activate(harness.context);
    const handler = harness.commands.get("core.files.save");
    await handler?.();

    expect(harness.context.fileMediator.saveFile).toHaveBeenCalledWith("context-active-file");
  });

  it("save as command forces a save dialog through the mediator", async () => {
    const harness = createHarness();

    coreFilesPlugin.activate(harness.context);
    const handler = harness.commands.get("core.files.saveAs");
    await handler?.();

    expect(harness.context.fileMediator.saveFile).toHaveBeenCalledWith("active-file", { saveAs: true });
  });

  it("registers toolbar new menu with configured mime type order", () => {
    const harness = createHarness();

    coreFilesPlugin.activate(harness.context);

    const toolbarMenu = harness.toolbarActions.find(
      (item) => item.id === "core.files.toolbar.new.menu"
    ) as
      | {
          type: string;
          getItems: () => Array<{ value: string; label: string }>;
        }
      | undefined;
    expect(toolbarMenu).toBeDefined();
    expect(toolbarMenu?.type).toBe("menu");

    const options = toolbarMenu?.getItems() ?? [];
    expect(options.map((option) => option.value)).toEqual([
      "application/plbsql",
      "application/sql"
    ]);
    expect(options.map((option) => option.label)).toEqual(["Payloadbuilder", "Jdbc"]);
  });

  it("uses all creatable mime types when setting is empty", async () => {
    const harness = createHarness();
    settingsServiceMock.getValue.mockImplementation((settingId) => {
      if (settingId === "core.files.mimeTypes") {
        return [];
      }
      return undefined;
    });

    coreFilesPlugin.activate(harness.context);

    const newItem = harness.menuItems.find((item) => item.id === "core.files.menu.new") as
      | {
          dynamicItems?: () => Promise<Array<{ commandId?: string }>>;
        }
      | undefined;

    const dynamicItems = (await newItem?.dynamicItems?.()) ?? [];
    expect(dynamicItems.map((item) => item.commandId)).toEqual([
      "core.files.new.fromMime.application/sql",
      "core.files.new.fromMime.application/plbsql",
      "core.files.new.fromMime.application/json"
    ]);
  });

  it("registers File > New as submenu parent that also has commandId", async () => {
    const harness = createHarness();

    coreFilesPlugin.activate(harness.context);

    const newItem = harness.menuItems.find((item) => item.id === "core.files.menu.new") as
      | {
          type?: string;
          commandId?: string;
          dynamicItems?: () => Promise<Array<{ parentId?: string }>>;
        }
      | undefined;
    expect(newItem?.type).toBe("submenu");
    expect(newItem?.commandId).toBe("core.files.new");

    const dynamicItems = await newItem?.dynamicItems?.();
    expect(dynamicItems?.length).toBeGreaterThan(0);
    expect(dynamicItems?.every((item) => item.parentId === "core.files.menu.new")).toBe(true);
  });

  it("applies tab background color from mime type setting", () => {
    const harness = createHarness();
    settingsServiceMock.getValue.mockImplementation((settingId) => {
      if (settingId === "core.files.mimeTypes") {
        return [
          { mimeType: "application/sql", enableForNew: true, color: "#ff0000" }
        ];
      }
      return undefined;
    });

    coreFilesPlugin.activate(harness.context);

    const calls = (harness.context.layout.registerTabHeaderStyle as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ id: string; render: (ctx: { file: FileEntity; isActive: boolean; hasCapability: (cap: string) => boolean }) => unknown }]>;
    const tabHeaderStyle = calls.find((call) => call[0].id === "core.files.tabHeaderStyle.mimeColor");
    expect(tabHeaderStyle).toBeDefined();
    const result = tabHeaderStyle![0].render({
      file: {
        fileId: "f-1",
        version: 0,
        uri: "untitled:Untitled1.sql",
        mimeType: "application/sql",
        dirtyVsBackend: false,
        dirtyVsDisk: false,
        diskState: "inSync",
        openedAt: new Date().toISOString()
      },
      isActive: false,
      hasCapability: () => true
    });
    expect(result).toEqual({
      className: "tab-accent",
      style: { "--tab-accent-color": "#ff0000" }
    });
  });

  it("returns no tab style when mime type has no color", () => {
    const harness = createHarness();
    settingsServiceMock.getValue.mockImplementation((settingId) => {
      if (settingId === "core.files.mimeTypes") {
        return [
          { mimeType: "application/sql", enableForNew: true }
        ];
      }
      return undefined;
    });

    coreFilesPlugin.activate(harness.context);

    const calls = (harness.context.layout.registerTabHeaderStyle as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ id: string; render: (ctx: { file: FileEntity; isActive: boolean; hasCapability: (cap: string) => boolean }) => unknown }]>;
    const tabHeaderStyle = calls.find((call) => call[0].id === "core.files.tabHeaderStyle.mimeColor");
    expect(tabHeaderStyle).toBeDefined();
    const result = tabHeaderStyle![0].render({
      file: {
        fileId: "f-1",
        version: 0,
        uri: "untitled:Untitled1.sql",
        mimeType: "application/sql",
        dirtyVsBackend: false,
        dirtyVsDisk: false,
        diskState: "inSync",
        openedAt: new Date().toISOString()
      },
      isActive: false,
      hasCapability: () => true
    });
    expect(result).toBeNull();
  });

  it("mime types renderer resolves latest registered mime types at render time", () => {
    const harness = createHarness();

    coreFilesPlugin.activate(harness.context);

    const rendererCalls = (harness.context.settings.registerAdvancedRenderer as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ id: string; render: (params: { value: unknown; setValue: (value: unknown) => void; readonly: boolean }) => JSX.Element }]>
    ;
    const mimeRenderer = rendererCalls.find((call) => call[0].id === "core.files.mimeTypes.renderer")?.[0];
    expect(mimeRenderer).toBeDefined();

    const listAllMimeTypesMock = harness.context.files.capabilities.listAllMimeTypes as ReturnType<typeof vi.fn>;
    listAllMimeTypesMock.mockReturnValue([
      "application/sql",
      "application/plbsql",
      "application/json",
      "application/vnd.queryeer.flow+plain"
    ]);

    const element = mimeRenderer!.render({
      value: [],
      setValue: () => {},
      readonly: false
    });

    const props = element.props as {
      options: Array<{ mimeType: string }>;
    };
    expect(props.options.map((option) => option.mimeType)).toContain("application/vnd.queryeer.flow+plain");
  });

  it("keeps non-creatable mime types colorable but out of New menus", () => {
    const harness = createHarness();
    const qjdbcGraphMimeType = "application/vnd.queryeer.jdbc-schema-graph+json";
    settingsServiceMock.getValue.mockImplementation((settingId) => {
      if (settingId === "core.files.mimeTypes") {
        return [
          { mimeType: qjdbcGraphMimeType, enableForNew: true, color: "#00ff00" },
          { mimeType: "application/sql", enableForNew: true }
        ];
      }
      return undefined;
    });
    (harness.context.files.capabilities.listAllMimeTypes as ReturnType<typeof vi.fn>).mockReturnValue([
      "application/sql",
      qjdbcGraphMimeType
    ]);
    (harness.context.files.capabilities.listMimeTypesByCapability as ReturnType<typeof vi.fn>).mockImplementation((capability) => {
      return capability === "creatable" ? ["application/sql"] : [];
    });
    (harness.context.files.capabilities.hasCapability as ReturnType<typeof vi.fn>).mockImplementation((mimeType, capability) => {
      return mimeType === "application/sql" || capability !== "creatable";
    });

    coreFilesPlugin.activate(harness.context);

    const toolbarMenu = harness.toolbarActions.find(
      (item) => item.id === "core.files.toolbar.new.menu"
    ) as
      | {
          getItems: () => Array<{ value: string }>;
        }
      | undefined;
    expect(toolbarMenu?.getItems().map((option) => option.value)).toEqual(["application/sql"]);

    const rendererCalls = (harness.context.settings.registerAdvancedRenderer as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ id: string; render: (params: { value: unknown; setValue: (value: unknown) => void; readonly: boolean }) => JSX.Element }]>
    ;
    const mimeRenderer = rendererCalls.find((call) => call[0].id === "core.files.mimeTypes.renderer")?.[0];
    const element = mimeRenderer!.render({
      value: [],
      setValue: () => {},
      readonly: false
    });
    const props = element.props as {
      options: Array<{ mimeType: string; canCreate: boolean }>;
    };
    expect(props.options.find((option) => option.mimeType === qjdbcGraphMimeType)?.canCreate).toBe(false);

    const calls = (harness.context.layout.registerTabHeaderStyle as ReturnType<typeof vi.fn>).mock
      .calls as Array<[{ id: string; render: (ctx: { file: FileEntity; isActive: boolean; hasCapability: (cap: string) => boolean }) => unknown }]>
    ;
    const tabHeaderStyle = calls.find((call) => call[0].id === "core.files.tabHeaderStyle.mimeColor");
    const result = tabHeaderStyle![0].render({
      file: {
        fileId: "f-graph",
        version: 0,
        uri: "untitled:ER.qjdbcgraph",
        mimeType: qjdbcGraphMimeType,
        dirtyVsBackend: false,
        dirtyVsDisk: false,
        diskState: "inSync",
        openedAt: new Date().toISOString()
      },
      isActive: false,
      hasCapability: () => false
    });
    expect(result).toEqual({
      className: "tab-accent",
      style: { "--tab-accent-color": "#00ff00" }
    });
  });
});
