import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";

const editorRegistryHostMock = vi.hoisted(() => ({
  registerContentRepository: vi.fn(() => () => {})
}));

vi.mock("../../../core/plugin-runtime/ExtensionRegistry", () => ({
  getEditorRegistryHost: () => editorRegistryHostMock,
  getOutlineRegistry: () => ({
    registerOutlineProvider: vi.fn(),
    registerSupplementaryOutlineProvider: vi.fn(),
    hasProvider: vi.fn(() => false),
    getProvider: vi.fn(),
    getSymbols: vi.fn(async () => [])
  }),
  getContextMenuProviders: () => []
}));

const commandRegisterMock = vi.hoisted(() => vi.fn());
const keybindingRegisterMock = vi.hoisted(() => vi.fn());
const mimeRegisterMock = vi.hoisted(() => vi.fn());
const preloadMonacoMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("./commands", () => ({
  registerTextEditorCommands: (...args: unknown[]) => {
    commandRegisterMock(...args);
  }
}));

vi.mock("./keybindings", () => ({
  registerTextEditorKeybindings: (...args: unknown[]) => {
    keybindingRegisterMock(...args);
  }
}));

vi.mock("./mime-types", () => ({
  registerTextEditorMimeTypes: (...args: unknown[]) => {
    mimeRegisterMock(...args);
  }
}));

vi.mock("./MonacoTextEditorApi", () => ({
  preloadMonaco: () => preloadMonacoMock()
}));

import { coreEditorTextPlugin } from "./plugin";

type Harness = {
  context: PluginContext;
  registerEditorMock: ReturnType<typeof vi.fn>;
};

function createHarness(): Harness {
  const registerEditorMock = vi.fn();
  const filesById = new Map<string, FileEntity>();
  const files = {
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
      getContentCategory: vi.fn(() => "text")
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
    classifyUri: vi.fn(() => "text/plain"),
    resolveEditor: vi.fn(),
    getEditorState: vi.fn(),
    setEditorState: vi.fn(),
    markDirty: vi.fn()
  };

  const context: PluginContext = {
    commands: {
      registerCommand: vi.fn(),
      executeCommand: vi.fn(async () => ({ commandId: "noop", executed: true })),
      canExecuteCommand: vi.fn(() => true)
    },
    filesystems: { registerFileSystem: vi.fn() },
    graphNodeTypes: { registerNodeType: vi.fn(), unregisterNodeType: vi.fn(), getComponent: vi.fn(), getAll: vi.fn(() => new Map()) },
    files,
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
      registerEditor: registerEditorMock,
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
      showMessage: vi.fn(),
      showOpenDialog: vi.fn(),
      showOpenFolder: vi.fn(),
      showSaveDialog: vi.fn(),
      showInputDialog: vi.fn()
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
    components: {
      FrameworkEditor: vi.fn()
    },
    about: { registerChangelog: vi.fn() },
    notifications: {
      notify: vi.fn(),
      list: vi.fn(() => []),
      unreadCount: vi.fn(() => 0),
      markRead: vi.fn(),
      markAllRead: vi.fn(),
      dismissToast: vi.fn(),
      clear: vi.fn(),
      clearAll: vi.fn(),
      subscribe: vi.fn(() => () => {})
    },
    assistant: {
      registerContextContribution: vi.fn(() => () => {}),
      registerToolContribution: vi.fn(() => () => {}),
      collectContext: vi.fn(async () => []),
      listTools: vi.fn(() => []),
      invokeTool: vi.fn(async () => ({ ok: false }))
    },
    payloadbuilderCatalog: { registerContribution: vi.fn() }
  } as unknown as PluginContext;

  return {
    context,
    registerEditorMock
  };
}

describe("core.editor.text plugin", () => {
  beforeEach(() => {
    editorRegistryHostMock.registerContentRepository.mockClear();
    commandRegisterMock.mockClear();
    keybindingRegisterMock.mockClear();
    mimeRegisterMock.mockClear();
    preloadMonacoMock.mockClear();
  });

  it("registers split-capable text editor and forwards instance context", () => {
    const harness = createHarness();
    coreEditorTextPlugin.activate(harness.context);

    expect(harness.registerEditorMock).toHaveBeenCalledTimes(1);
    const contribution = harness.registerEditorMock.mock.calls[0][0] as {
      canSplit?: boolean;
      render: (context?: {
        activeFile?: FileEntity;
        editorInstanceId?: string;
        isActiveEditorGroup?: boolean;
      }) => {
        props?: {
          editorInstanceId?: string;
          file?: FileEntity;
          isActiveEditorGroup?: boolean;
        };
      };
    };

    expect(contribution.canSplit).toBe(true);

    const file: FileEntity = {
      fileId: "file-1",
      version: 1,
      uri: "file:///test.sql",
      mimeType: "application/sql",
      dirtyVsBackend: false,
      dirtyVsDisk: false,
      diskState: "inSync",
      openedAt: new Date().toISOString()
    };
    const rendered = contribution.render({
      activeFile: file,
      editorInstanceId: "group-1:core.editor.text",
      isActiveEditorGroup: false
    });

    expect(rendered.props?.editorInstanceId).toBe("group-1:core.editor.text");
    expect(rendered.props?.isActiveEditorGroup).toBe(false);
    expect(rendered.props?.file).toBe(file);
    expect(editorRegistryHostMock.registerContentRepository).toHaveBeenCalled();
    expect(commandRegisterMock).toHaveBeenCalledTimes(1);
    expect(keybindingRegisterMock).toHaveBeenCalledTimes(1);
    expect(mimeRegisterMock).toHaveBeenCalledTimes(1);
    expect(preloadMonacoMock).toHaveBeenCalledTimes(1);
  });
});
