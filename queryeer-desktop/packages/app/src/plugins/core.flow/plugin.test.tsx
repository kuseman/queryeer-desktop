import React from "react";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import {
  FLOW_DOCUMENT_EDITOR_ID,
  FLOW_DOCUMENT_EXTENSION,
  FLOW_DOCUMENT_MIME_TYPE
} from "@queryeer/api/flow/constants";
import { coreFlowPlugin } from "./plugin";
import { FLOW_ENVIRONMENTS_SETTING_ID } from "./flow-environment";

void React;

vi.mock("../../core/plugin-runtime/ExtensionRegistry", () => ({
  getEditorRegistryHost: () => ({
    getActiveEditor: () => null,
    onActiveEditorChanged: () => ({ dispose: () => {} }),
    setActiveEditor: () => {},
    registerContentRepository: () => () => {},
    resolveFileContent: () => undefined,
    broadcastContentUpdate: () => {},
    applyRecoveredContent: vi.fn(),
    onContentDirty: () => () => {}
  }),
  getOutlineRegistry: () => ({
    registerOutlineProvider: () => {},
    registerSupplementaryOutlineProvider: () => {},
    hasProvider: () => false,
    getProvider: () => undefined,
    getSymbols: async () => []
  })
}));

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

function createAssistantRegistryMock() {
  return {
    registerContextContribution: vi.fn(() => () => {}),
    registerToolContribution: vi.fn(() => () => {}),
    collectContext: vi.fn(async () => []),
    listTools: vi.fn(() => []),
    invokeTool: vi.fn(async () => ({ ok: false }))
  };
}

function createContext(): PluginContext {
  const commands = new Map<string, () => Promise<void> | void>();
  const file = {
    fileId: "flow-1",
    version: 0,
    uri: "untitled:Flow.qflow",
    mimeType: FLOW_DOCUMENT_MIME_TYPE,
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync" as const,
    openedAt: new Date().toISOString()
  };

  return {
    commands: {
      registerCommand: vi.fn((command: { id: string; handler: () => Promise<void> | void }) => {
        commands.set(command.id, command.handler);
      }),
      executeCommand: vi.fn(async () => ({ commandId: "noop", executed: true })),
      canExecuteCommand: vi.fn(() => true)
    },
    filesystems: { registerFileSystem: vi.fn() },
    files: {
      capabilities: {
        registerCapabilities: vi.fn(),
        registerLabel: vi.fn(),
        registerPreferredExtension: vi.fn(),
        registerPreferredNewFileMimeType: vi.fn(),
        listPreferredNewFileMimeTypes: vi.fn(() => []),
        getLabel: vi.fn(),
        hasCapability: vi.fn(() => false),
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
      classifyUri: vi.fn(() => "text/plain"),
      resolveEditor: vi.fn(),
      getEditorState: vi.fn(),
      setEditorState: vi.fn(),
      markDirty: vi.fn()
    },
    fileState: { get: vi.fn(), set: vi.fn(), delete: vi.fn(), evict: vi.fn() },
    fileMediator: {
      openFile: vi.fn(),
      createUntitledFile: vi.fn(async () => file),
      getUntitledCounter: vi.fn(() => 0),
      setUntitledCounter: vi.fn(),
      closeFile: vi.fn(),
      saveFile: vi.fn(),
      setActiveFileId: vi.fn(),
      getActiveFileId: vi.fn(() => file.fileId),
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
    tooltip: { registerTooltipSection: vi.fn() },
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
    outline: {
      registerOutlineProvider: vi.fn(),
      registerSupplementaryOutlineProvider: vi.fn(),
      hasProvider: vi.fn(() => false),
      getProvider: vi.fn(),
      getSymbols: vi.fn(async () => [])
    },
    editors: {
      getActiveEditor: vi.fn(() => null),
      onActiveEditorChanged: vi.fn(() => ({ dispose: vi.fn() }))
    },
    contextMenu: { registerProvider: vi.fn(), unregisterProvider: vi.fn() },
    tableOutputContextMenu: { registerProvider: vi.fn(), unregisterProvider: vi.fn() },
    jdbcTreeContextMenu: { registerContribution: vi.fn(), unregisterContribution: vi.fn(), getItemsForNode: vi.fn() },
    about: { registerChangelog: vi.fn() },
    notifications: createNotificationMock(),
    assistant: createAssistantRegistryMock()
  } as unknown as PluginContext;
}

describe("core.flow plugin", () => {
  it("registers flow mime/editor/view and creates seeded flow file", async () => {
    const context = createContext();
    const commandMap = new Map<string, () => Promise<void> | void>();

    (context.commands.registerCommand as ReturnType<typeof vi.fn>).mockImplementation(
      (command: { id: string; handler: () => Promise<void> | void }) => {
        commandMap.set(command.id, command.handler);
      }
    );

    await coreFlowPlugin.activate(context);

    expect(context.files.capabilities.registerCapabilities).toHaveBeenCalledWith(
      FLOW_DOCUMENT_MIME_TYPE,
      ["backupable", "editable", "viewable"]
    );
    expect(context.files.capabilities.registerContentCategory).toHaveBeenCalledWith(
      FLOW_DOCUMENT_MIME_TYPE,
      "text"
    );
    expect(context.files.capabilities.registerPreferredExtension).toHaveBeenCalledWith(
      FLOW_DOCUMENT_MIME_TYPE,
      FLOW_DOCUMENT_EXTENSION
    );
    expect(context.layout.registerEditor).toHaveBeenCalledWith(
      expect.objectContaining({
        id: FLOW_DOCUMENT_EDITOR_ID,
        supportedMimeTypes: [FLOW_DOCUMENT_MIME_TYPE]
      })
    );
    expect(context.settings.registerSettings).toHaveBeenCalledWith(expect.objectContaining({
      moduleId: "core.flow",
      settings: [expect.objectContaining({
        id: FLOW_ENVIRONMENTS_SETTING_ID,
        type: "json",
        scope: "workspace"
      })]
    }));
    expect(context.layout.registerView).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.flow.context",
        defaultZone: "primarySidebar"
      })
    );

    await commandMap.get("core.flow.new")?.();

    expect(context.fileMediator.createUntitledFile).toHaveBeenCalledWith({
      extension: FLOW_DOCUMENT_EXTENSION,
      mimeType: FLOW_DOCUMENT_MIME_TYPE,
      title: "Flow"
    });
  });
});
