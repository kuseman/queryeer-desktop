import { describe, expect, it, vi } from "vitest";
import { coreLayoutPlugin } from "./plugin";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import type { FileEntity } from "../../contracts/files/FileEntity";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "f-1",
    version: 1,
    uri: "file:///C:/tmp/a.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString(),
    ...overrides
  };
}

function createContext(file?: FileEntity) {
  const commands = new Map<string, () => void | Promise<void>>();
  const registerKeybinding = vi.fn();
  const closeFile = vi.fn(async () => {});
  const showMessage = vi.fn(async () => ({ action: "discard" }));

  const context = {
    commands: {
      registerCommand: (command: {
        id: string;
        title: string;
        handler: () => void | Promise<void>;
      }) => {
        commands.set(command.id, command.handler);
      },
      executeCommand: vi.fn(async () => ({ commandId: "x", executed: true })),
      canExecuteCommand: vi.fn(() => true)
    },
    filesystems: { registerFileSystem: vi.fn() },
    files: {
      capabilities: {
        registerCapabilities: vi.fn(),
        hasCapability: vi.fn(() => true),
        registerContentCategory: vi.fn(),
        getContentCategory: vi.fn(() => "text" as const)
      },
      openFile: vi.fn(),
      closeFile: vi.fn(),
      getFile: vi.fn(() => file),
      listFiles: vi.fn(() => (file ? [file] : [])),
      updateFile: vi.fn(),
      subscribe: vi.fn(() => () => {}),
      registerMimeResolver: vi.fn(),
      registerEditorResolver: vi.fn(),
      classifyUri: vi.fn(() => "text/plain"),
      resolveEditor: vi.fn(),
      getEditorState: vi.fn(),
      setEditorState: vi.fn(),
      markDirty: vi.fn()
    },
    fileMediator: {
      openFile: vi.fn(),
      closeFile,
      saveFile: vi.fn(),
      setActiveFileId: vi.fn(),
      getActiveFileId: vi.fn(() => file?.fileId ?? null),
      setContextFileId: vi.fn(),
      getContextFileId: vi.fn(() => null),
      bindEngine: vi.fn(),
      executeFile: vi.fn(),
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
      registerPanel: vi.fn(),
      setShellDefaults: vi.fn()
    },
    menu: { registerMenuItem: vi.fn(), rebuildMenu: vi.fn(), onRebuild: vi.fn() },
    keybindings: { registerKeybinding },
    dialog: {
      showMessage,
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
    quickcommand: { registerProvider: vi.fn() }
  } satisfies PluginContext;

  return {
    context,
    commands,
    registerKeybinding,
    closeFile,
    showMessage
  };
}

describe("core.layout close editor", () => {
  it("registers CmdOrCtrl+W keybinding", () => {
    const { context, registerKeybinding } = createContext();
    coreLayoutPlugin.activate(context);

    expect(registerKeybinding).toHaveBeenCalledWith(
      expect.objectContaining({
        commandId: "core.closeActive",
        key: "CmdOrCtrl+W"
      })
    );
  });

  it("closes active clean file without confirmation", async () => {
    const file = makeFile({ dirtyVsDisk: false, dirtyVsBackend: false });
    const { context, commands, closeFile, showMessage } = createContext(file);
    coreLayoutPlugin.activate(context);

    const handler = commands.get("core.closeActive");
    expect(handler).toBeTruthy();
    await handler?.();

    expect(showMessage).not.toHaveBeenCalled();
    expect(closeFile).toHaveBeenCalledWith(file.fileId, { discardDirty: true });
  });

  it("asks confirmation for dirty file and respects cancel", async () => {
    const file = makeFile({ uri: "untitled:Query.sql", dirtyVsDisk: true });
    const { context, commands, closeFile, showMessage } = createContext(file);
    showMessage.mockResolvedValueOnce({ action: "cancel" });
    coreLayoutPlugin.activate(context);

    const handler = commands.get("core.closeActive");
    await handler?.();

    expect(showMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Unsaved Changes",
        message: expect.stringContaining("Query.sql")
      })
    );
    expect(closeFile).not.toHaveBeenCalled();
  });
});
