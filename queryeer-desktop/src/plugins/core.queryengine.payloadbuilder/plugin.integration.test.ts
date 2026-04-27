import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../../contracts/plugin/Plugin";

const mocks = vi.hoisted(() => ({
  registerExecutionContextProviderMock: vi.fn(),
  registerEngineResolverMock: vi.fn(),
  onQueryEventMock: vi.fn(),
  buildEngineStateMock: vi.fn(),
  applyEngineStatePatchMock: vi.fn(),
  initializeStoreMock: vi.fn(),
  getCoreSettingsServiceMock: vi.fn(() => null)
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
    applyEngineStatePatch: mocks.applyEngineStatePatchMock
  })
}));

vi.mock("../core.settings/service", () => ({
  getCoreSettingsService: () => mocks.getCoreSettingsServiceMock()
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
        hasCapability: vi.fn(() => true),
        registerContentCategory: vi.fn(),
        getContentCategory: vi.fn(() => "text" as const)
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

describe("core.queryengine.payloadbuilder plugin integration", () => {
  beforeEach(() => {
    mocks.registerExecutionContextProviderMock.mockReset();
    mocks.registerEngineResolverMock.mockReset();
    mocks.onQueryEventMock.mockReset();
    mocks.buildEngineStateMock.mockReset();
    mocks.applyEngineStatePatchMock.mockReset();
    mocks.initializeStoreMock.mockReset();
    mocks.getCoreSettingsServiceMock.mockReset();
    mocks.getCoreSettingsServiceMock.mockReturnValue(null);
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

  it("applies completed engineStatePatch back into store for payloadbuilder", () => {
    const context = createContext();
    coreQueryEnginePayloadbuilderPlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((
          event: { method: string; params?: { engineStatePatch?: unknown } },
          executeContext?: { engineId?: string; fileId?: string }
        ) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      {
        method: "query.completed",
        params: {
          engineStatePatch: {
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
      { method: "query.completed", params: { engineStatePatch: { ignored: true } } },
      { engineId: "jdbc", fileId: "file-1" }
    );
    listener?.({ method: "query.completed", params: {} }, { engineId: "payloadbuilder", fileId: "file-1" });
    listener?.(
      { method: "query.completed", params: { engineStatePatch: { ignored: true } } },
      { engineId: "payloadbuilder" }
    );
    listener?.(
      { method: "query.failed", params: { engineStatePatch: { ignored: true } } },
      { engineId: "payloadbuilder", fileId: "file-1" }
    );

    expect(mocks.applyEngineStatePatchMock).toHaveBeenCalledTimes(1);
  });
});
