import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { PluginContext } from "../../contracts/plugin/Plugin";

const mocks = vi.hoisted(() => ({
  initializeMock: vi.fn(),
  onQueryEventMock: vi.fn(),
  registerEngineResolverMock: vi.fn(),
  requestExecuteMock: vi.fn(),
  requestCancelMock: vi.fn(),
  setFilesRegistryMock: vi.fn()
}));

vi.mock("./QueryEngineService", () => ({
  getQueryEngineService: () => ({
    initialize: mocks.initializeMock,
    onQueryEvent: mocks.onQueryEventMock,
    registerEngineResolver: mocks.registerEngineResolverMock,
    requestExecute: mocks.requestExecuteMock,
    requestCancel: mocks.requestCancelMock
  })
}));

vi.mock("./QueryTextEditorRegistry", () => ({
  queryTextRegistry: {
    setFilesRegistry: mocks.setFilesRegistryMock
  }
}));

import { coreQueryEnginePlugin } from "./plugin";

function makeFile(overrides: Partial<FileEntity> = {}): FileEntity {
  return {
    fileId: "file-1",
    version: 1,
    uri: "file:///C:/tmp/a.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    openedAt: new Date().toISOString(),
    metadata: { keep: true },
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
    files: {
      capabilities: {
        registerCapabilities: vi.fn(),
        hasCapability: vi.fn(() => true),
        registerContentCategory: vi.fn(),
        getContentCategory: vi.fn(() => "text" as const)
      },
      openFile: vi.fn(),
      closeFile: vi.fn(),
      getFile: vi.fn((fileId: string) => filesById.get(fileId)),
      listFiles: vi.fn(() => [...filesById.values()]),
      updateFile: vi.fn((fileId: string, update: Partial<FileEntity>) => {
        const existing = filesById.get(fileId);
        if (!existing) {
          return undefined;
        }
        const next = { ...existing, ...update };
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
      closeFile: vi.fn(),
      saveFile: vi.fn(),
      setActiveFileId: vi.fn(),
      getActiveFileId: vi.fn(() => null),
      setContextFileId: vi.fn(),
      getContextFileId: vi.fn(() => null),
      bindEngine: vi.fn(),
      executeFile: vi.fn(),
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
    }
  };
}

describe("core.queryengine plugin", () => {
  beforeEach(() => {
    mocks.initializeMock.mockReset();
    mocks.onQueryEventMock.mockReset();
    mocks.registerEngineResolverMock.mockReset();
    mocks.requestExecuteMock.mockReset();
    mocks.requestCancelMock.mockReset();
    mocks.setFilesRegistryMock.mockReset();
  });

  it("registers a queryexecutable tab header style contribution", () => {
    const context = createContext(makeFile());

    coreQueryEnginePlugin.activate(context);

    expect(mocks.registerEngineResolverMock).toHaveBeenCalledTimes(1);

    const registerEditorMock = context.layout.registerEditor as ReturnType<typeof vi.fn>;
    expect(registerEditorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.editor",
        supportedContentCategories: ["text"],
        requiredCapabilities: ["queryexecutable"]
      })
    );

    const registerTabHeaderStyleMock = context.layout.registerTabHeaderStyle as ReturnType<typeof vi.fn>;
    expect(registerTabHeaderStyleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.tabHeaderStyle.execution"
      })
    );
  });

  it("updates tab metadata from running to cleared on completion", () => {
    const file = makeFile();
    const context = createContext(file);
    coreQueryEnginePlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((event: { method: string; params?: { queryExecutionId?: string } }, executeContext?: { fileId?: string }) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      { method: "query.started", params: { queryExecutionId: "q-1" } },
      { fileId: "file-1" }
    );
    expect(context.files.updateFile).toHaveBeenCalledWith(
      "file-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          keep: true,
          "core.queryengine.tabState": "running"
        })
      })
    );

    listener?.({ method: "query.completed", params: { queryExecutionId: "q-1" } }, {});
    expect(context.files.updateFile).toHaveBeenLastCalledWith(
      "file-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          keep: true
        })
      })
    );
    const lastCallMetadata = (context.files.updateFile as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]
      ?.metadata as Record<string, unknown>;
    expect(lastCallMetadata["core.queryengine.tabState"]).toBeUndefined();
  });

  it("keeps failed tab metadata until next execution", () => {
    const file = makeFile();
    const context = createContext(file);
    coreQueryEnginePlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((event: { method: string; params?: { queryExecutionId?: string } }, executeContext?: { fileId?: string }) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      { method: "query.started", params: { queryExecutionId: "q-2" } },
      { fileId: "file-1" }
    );
    listener?.({ method: "query.failed", params: { queryExecutionId: "q-2" } }, {});

    expect(context.files.updateFile).toHaveBeenLastCalledWith(
      "file-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          "core.queryengine.tabState": "failed"
        })
      })
    );
  });

  it("marks backend-dependent commands with backendHealthy enablement", () => {
    const context = createContext(makeFile());
    coreQueryEnginePlugin.activate(context);

    const registerCommandMock = context.commands.registerCommand as ReturnType<typeof vi.fn>;
    expect(registerCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.execute",
        enablement: "backendHealthy && editorFocus && hasActiveQueryExecutableFile && activeFileMetadata.core.queryengine.tabState != 'running'"
      })
    );
    expect(registerCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.cancel",
        enablement: "backendHealthy && editorFocus && hasActiveQueryExecutableFile && activeFileMetadata.core.queryengine.tabState == 'running'"
      })
    );
  });
});
