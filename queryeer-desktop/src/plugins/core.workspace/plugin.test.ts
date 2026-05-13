import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import type { QuickCommandContext, QuickCommandProvider } from "../../contracts/extensions/QuickCommandExtension";
import { coreWorkspacePlugin } from "./plugin";

const getRecentFilesMock = vi.fn(async () => [] as Array<{ uri: string }>);

vi.mock("../core.quickcommand/service", () => ({
  getQuickCommandService: () => ({ open: vi.fn() })
}));

describe("coreWorkspacePlugin quick command providers", () => {
  beforeEach(() => {
    getRecentFilesMock.mockReset();
  });

  it("filters already open files from recent provider", async () => {
    getRecentFilesMock.mockResolvedValue([
      { uri: "file:///tmp/a.sql" },
      { uri: "file:///tmp/b.sql" }
    ]);

    const providers: QuickCommandProvider[] = [];
    const context = createContext(providers);

    coreWorkspacePlugin.activate(context);

    const recentProvider = providers.find((provider) => provider.label === "Recent Files");
    expect(recentProvider).toBeDefined();

    const items = await recentProvider!.getItems("", {
      openFiles: [
        {
          fileId: "f-1",
          version: 1,
          uri: "file:///tmp/a.sql",
          mimeType: "application/sql",
          dirtyVsBackend: false,
          dirtyVsDisk: false,
          diskState: "inSync",
          openedAt: new Date().toISOString()
        }
      ]
    } as QuickCommandContext);

    expect(items.map((item) => item.id)).toEqual(["workspace.recentFile.file:///tmp/b.sql"]);
  });
});

function createContext(providers: QuickCommandProvider[]): PluginContext {
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

Object.defineProperty(window, "appShell", {
  value: {
    getRecentFiles: getRecentFilesMock
  },
  configurable: true
});
