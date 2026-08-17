import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import type { QuickCommandProvider } from "@queryeer/api/extensions/QuickCommandExtension";

const settingsState = new Map<string, unknown>();
const settingsServiceMock = {
  getValue: vi.fn((settingId: string) => settingsState.get(settingId)),
  setValue: vi.fn(async (settingId: string, value: unknown) => {
    settingsState.set(settingId, value);
    return { ok: true };
  })
};

vi.mock("../core.settings/service", () => ({
  getCoreSettingsService: () => settingsServiceMock,
  onCoreSettingsServiceInitialized: (_listener: (service: unknown) => void) => () => {}
}));

import { coreExplorerPlugin } from "./plugin";
import { createExplorerStore } from "./store";

describe("coreExplorerPlugin", () => {
  beforeEach(() => {
    createExplorerStore();
    settingsState.clear();
    settingsServiceMock.getValue.mockClear();
    settingsServiceMock.setValue.mockClear();
  });

  it("watches added folders recursively", async () => {
    const commands = new Map<string, () => Promise<void> | void>();
    const watch = vi.fn(async () => ({ subscriptionId: "sub-1", unsubscribe: vi.fn(async () => {}) }));
    const context = createContext({
      commands,
      watch,
      showOpenFolder: vi.fn(async () => ({ canceled: false, folderPath: "C:/tmp/work" })),
      readDir: vi.fn(async () => ({ success: true, items: [] }))
    });

    coreExplorerPlugin.activate(context);
    const addFolder = commands.get("core.explorer.addFolder");
    expect(addFolder).toBeDefined();

    await addFolder!();

    expect(watch).toHaveBeenCalled();
    const firstCall = watch.mock.calls[0] as unknown[] | undefined;
    expect(firstCall?.[1]).toEqual({ recursive: true });
  });

  it("registers quick command provider for explorer files", async () => {
    const providers: QuickCommandProvider[] = [];
    const commands = new Map<string, () => Promise<void> | void>();
    const context = createContext({
      commands,
      providers,
      showOpenFolder: vi.fn(async () => ({ canceled: false, folderPath: "C:/tmp/work" })),
      watch: vi.fn(async () => ({ subscriptionId: "sub-1", unsubscribe: vi.fn(async () => {}) })),
      readDir: vi.fn(async ({ uri }: { uri: string }) => {
        if (uri.endsWith("/work")) {
          return {
            success: true,
            items: [{ name: "a.sql", isDirectory: false, isFile: true, size: 1, modified: "" }]
          };
        }
        return { success: true, items: [] };
      })
    });

    coreExplorerPlugin.activate(context);
    await commands.get("core.explorer.addFolder")!();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const provider = providers.find((item) => item.label === "Explorer Files");
    expect(provider).toBeDefined();

    const items = await provider!.getItems("", { activeFile: undefined, openFiles: [] });
    expect(items.some((item) => item.id.startsWith("explorer.file."))).toBe(true);
  });

  it("persists tracked folders with per-folder regex", async () => {
    const commands = new Map<string, () => Promise<void> | void>();
    const context = createContext({
      commands,
      watch: vi.fn(async () => ({ subscriptionId: "sub-1", unsubscribe: vi.fn(async () => {}) })),
      showOpenFolder: vi.fn(async () => ({ canceled: false, folderPath: "C:/tmp/work" })),
      readDir: vi.fn(async () => ({ success: true, items: [] }))
    });
    context.dialog.showInputDialog = vi.fn(async () => ({ canceled: false, value: "\\.(sql|plbsql)$" }));

    coreExplorerPlugin.activate(context);
    await commands.get("core.explorer.addFolder")!();

    expect(settingsServiceMock.setValue).toHaveBeenCalled();
    const persisted = settingsState.get("core.explorer.trackedFolders") as Array<Record<string, unknown>>;
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted[0]?.filterRegex).toBe("\\.(sql|plbsql)$");
  });
});

function createContext(args: {
  commands: Map<string, () => Promise<void> | void>;
  providers?: QuickCommandProvider[];
  watch: ReturnType<typeof vi.fn>;
  showOpenFolder: ReturnType<typeof vi.fn>;
  readDir: ReturnType<typeof vi.fn>;
}): PluginContext {
  Object.defineProperty(window, "appShell", {
    value: {
      readDir: args.readDir
    },
    configurable: true
  });

  const providers = args.providers ?? [];

  return {
    commands: {
      registerCommand: vi.fn((command) => {
        args.commands.set(command.id, command.handler);
      }),
      executeCommand: vi.fn(async () => ({ commandId: "noop", executed: true })),
      canExecuteCommand: vi.fn(() => true)
    },
    filesystems: { registerFileSystem: vi.fn() },
    graphNodeTypes: { registerNodeType: vi.fn(), unregisterNodeType: vi.fn(), getComponent: vi.fn(), getAll: vi.fn(() => new Map()) },
    files: {
      capabilities: {
        registerCapabilities: vi.fn(),
        hasCapability: vi.fn(() => true),
        listMimeTypesByCapability: vi.fn(() => []),
        listAllMimeTypes: vi.fn(() => []),
        registerContentCategory: vi.fn(),
        getContentCategory: vi.fn()
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
    fileState: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), evict: vi.fn() },
    fileMediator: {
      openFile: vi.fn(),
      createUntitledFile: vi.fn(),
      getUntitledCounter: vi.fn(() => 0),
      setUntitledCounter: vi.fn(),
      closeFile: vi.fn(),
      saveFile: vi.fn(),
      setActiveFileId: vi.fn(),
      getActiveFileId: vi.fn(() => null),
      onActiveFileChanged: vi.fn(() => () => {}),
      setContextFileId: vi.fn(),
      getContextFileId: vi.fn(() => null),
      bindEngine: vi.fn(),
      reloadFile: vi.fn(),
      acceptExternalChange: vi.fn(),
      discardExternalChange: vi.fn()
    },
    fileWatcher: {
      watch: args.watch,
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
      rebuildMenu: vi.fn(async () => {}),
      onRebuild: vi.fn()
    },
    keybindings: { registerKeybinding: vi.fn() },
    dialog: {
      showMessage: vi.fn(async () => ({ action: "" })),
      showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })),
      showOpenFolder: args.showOpenFolder,
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
      showInputDialog: vi.fn(async () => ({ canceled: true, value: undefined }))
    },
    tooltip: { registerTooltipSection: vi.fn(), listTooltipSections: vi.fn(() => []) },
    settings: {
      registerSettings: vi.fn(),
      registerAdvancedRenderer: vi.fn(),
      registerAdvancedValidator: vi.fn(),
      listSettingsContributions: vi.fn(() => []),
      listSettingsDefinitions: vi.fn(() => []),
      getAdvancedRenderer: vi.fn(),
      getAdvancedValidator: vi.fn()
    },
    quickcommand: {
      registerProvider: vi.fn((provider) => {
        providers.push(provider);
      })
    },
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
