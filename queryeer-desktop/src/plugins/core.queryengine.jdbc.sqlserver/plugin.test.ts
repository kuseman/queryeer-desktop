import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginContext } from "../../contracts/plugin/Plugin";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { getExpressionRuntime } from "../core.expressions/runtime";

const mocks = vi.hoisted(() => ({
  registerJdbcDialectMock: vi.fn(),
  registerWhenExpressionTemplatesMock: vi.fn(),
  registerSymbolActionTemplateMock: vi.fn(),
  registerExecutionContextProviderMock: vi.fn(),
  getCoreSettingsValueMock: vi.fn(),
  refreshSchemaFromRegistryMock: vi.fn(),
  syncRegistryModulesMock: vi.fn(),
  readViewStateMock: vi.fn(() => ({})),
  setIncludeActualPlanMock: vi.fn(),
  requestExecuteMock: vi.fn(),
  getFileMock: vi.fn(),
  registerCommandMock: vi.fn(),
  registerToolbarActionMock: vi.fn(),
  registerSettingsMock: vi.fn(),
  registerAdvancedValidatorMock: vi.fn(),
  registerAdvancedRendererMock: vi.fn()
}));

vi.mock("../core.queryengine.jdbc/jdbc-dialect-registry", () => ({
  registerJdbcDialect: mocks.registerJdbcDialectMock
}));

vi.mock("../core.commands/when-expression-template-registry", () => ({
  registerWhenExpressionTemplates: mocks.registerWhenExpressionTemplatesMock
}));

vi.mock("../core.queryengine/symbol-action-template-registry", () => ({
  registerSymbolActionTemplate: mocks.registerSymbolActionTemplateMock
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({
    registerExecutionContextProvider: mocks.registerExecutionContextProviderMock,
    requestExecute: mocks.requestExecuteMock
  })
}));

vi.mock("../core.queryengine/QueryViewStateStore", () => ({
  getQueryViewStateStore: () => ({
    read: mocks.readViewStateMock,
    setIncludeActualPlan: mocks.setIncludeActualPlanMock
  })
}));

vi.mock("../core.settings/service", () => ({
  getCoreSettingsService: () => ({
    getValue: mocks.getCoreSettingsValueMock,
    refreshSchemaFromRegistry: mocks.refreshSchemaFromRegistryMock,
    syncRegistryModules: mocks.syncRegistryModulesMock
  })
}));

vi.mock("../core.quickcommand/service", () => ({
  getQuickCommandService: () => ({ open: vi.fn() })
}));

import { coreQueryEngineJdbcSqlServerPlugin } from "./plugin";

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
      registerCommand: mocks.registerCommandMock,
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
      getFile: mocks.getFileMock,
      listFiles: vi.fn(() => [...filesById.values()]),
      subscribe: vi.fn(() => () => {}),
      getFileByUri: vi.fn(),
      updateFile: vi.fn(),
      mimeIcons: { registerMimeIcon: vi.fn() },
      editorState: new Map(),
      setEditorState: vi.fn(),
      getEditorState: vi.fn()
    },
    layout: {
      registerView: vi.fn(),
      registerEditor: vi.fn(),
      registerToolbarAction: mocks.registerToolbarActionMock,
      registerTabHeaderStyle: vi.fn(),
      registerPanel: vi.fn(),
      registerTabTitle: vi.fn(),
      registerTabTitleContributor: vi.fn()
    },
    fileMediator: {
      getActiveFileId: vi.fn(() => null),
      setActiveFileId: vi.fn(),
      onActiveFileChanged: vi.fn(() => () => {}),
      openFile: vi.fn(),
      createUntitledFile: vi.fn(),
      onWillOpenFile: vi.fn(() => () => {})
    },
    settings: {
      registerSettings: mocks.registerSettingsMock,
      registerAdvancedValidator: mocks.registerAdvancedValidatorMock,
      registerAdvancedRenderer: mocks.registerAdvancedRendererMock,
      registerAdvancedEditor: vi.fn()
    },
    keybindings: { registerKeybinding: vi.fn() },
    contextMenu: { registerProvider: vi.fn() },
    quickcommand: { registerProvider: vi.fn() },
    tooltip: { registerTooltipSection: vi.fn(), listTooltipSections: vi.fn(() => []) },
    dialog: {
      showMessage: vi.fn(async () => ({ action: "ok" })),
      showInput: vi.fn(),
      registerConfirmDialog: vi.fn()
    },
  } as unknown as PluginContext;
}

describe("coreQueryEngineJdbcSqlServerPlugin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readViewStateMock.mockReturnValue({});
  });

  it("registers the connection form for sqlserver dialect", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlServerPlugin.activate(context);

    expect(mocks.registerJdbcDialectMock).toHaveBeenCalledWith({
      dialectId: "sqlserver",
      supportsQueryPlan: true,
      ConnectionForm: expect.any(Function)
    });
  });

  it("registers when-expression templates", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlServerPlugin.activate(context);

    expect(mocks.registerWhenExpressionTemplatesMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: "SQLServer Database" })
      ])
    );
  });

  it("registers symbol action template for SQL Server describe", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlServerPlugin.activate(context);

    expect(mocks.registerSymbolActionTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.jdbc.symbolAction.sqlserverDescribe",
        title: "SQLServer Describe",
        action: expect.objectContaining({
          query: expect.stringContaining("fn.sqlserver.identifier")
        })
      })
    );
  });

  it("registers SQL Server expression helpers from the dialect", () => {
    const context = createContext();

    coreQueryEngineJdbcSqlServerPlugin.activate(context);
    coreQueryEngineJdbcSqlServerPlugin.activate(context);

    const bindings = getExpressionRuntime().getFunctionRegistry().resolveRuntimeBindings();
    const sqlserver = bindings.sqlserver as { identifier?: (value: unknown) => string } | undefined;
    expect(sqlserver?.identifier?.("a]b")).toBe("[a]]b]");
  });

  it("does not own shared plan commands or toolbar actions", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlServerPlugin.activate(context);

    expect(mocks.registerCommandMock).not.toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringContaining("Plan")
    }));
    expect(mocks.registerToolbarActionMock).not.toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining("Plan")
    }));
  });

  it("registers the plan XML output setting", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlServerPlugin.activate(context);

    expect(mocks.registerSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleId: "core.queryengine.jdbc",
        settings: expect.arrayContaining([
          expect.objectContaining({
            id: "core.queryengine.jdbc.sqlserver.planXmlOutput"
          })
        ])
      })
    );
  });

  it("syncs settings service after registration", () => {
    const context = createContext();
    coreQueryEngineJdbcSqlServerPlugin.activate(context);

    expect(mocks.refreshSchemaFromRegistryMock).toHaveBeenCalledOnce();
    expect(mocks.syncRegistryModulesMock).toHaveBeenCalledOnce();
  });

  describe("execution context provider", () => {
    it("registers an execution context provider", () => {
      const context = createContext();
      coreQueryEngineJdbcSqlServerPlugin.activate(context);

      expect(mocks.registerExecutionContextProviderMock).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it("returns undefined for non-JDBC engines", () => {
      const context = createContext();
      coreQueryEngineJdbcSqlServerPlugin.activate(context);

      const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]![0];
      const result = provider({ engineId: "payloadbuilder", fileId: "file-1" });
      expect(result).toBeUndefined();
    });

    it("returns undefined when file has no sqlserver dialect", () => {
      const context = createContext();
      mocks.getFileMock.mockReturnValue({
        fileId: "file-1",
        metadata: { "core.queryengine.jdbc.dialectId": "postgres" }
      });
      coreQueryEngineJdbcSqlServerPlugin.activate(context);

      const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]![0];
      const result = provider({ engineId: "jdbc", fileId: "file-1" });
      expect(result).toBeUndefined();
    });

    it("adds actual plan options when includeActualPlan is true", () => {
      const context = createContext();
      mocks.getFileMock.mockReturnValue({
        fileId: "file-1",
        metadata: { "core.queryengine.jdbc.dialectId": "sqlserver" }
      });
      mocks.readViewStateMock.mockReturnValue({ includeActualPlan: true });
      mocks.getCoreSettingsValueMock.mockReturnValue("suppress");
      coreQueryEngineJdbcSqlServerPlugin.activate(context);

      const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]![0];
      const result = provider({ engineId: "jdbc", fileId: "file-1" });
      expect(result).toMatchObject({
        options: {
          intent: "plan.actual",
          dialectOptions: { sqlserverPlanXmlOutput: "suppress" }
        }
      });
    });

    it("does not override existing intent when includeActualPlan is true", () => {
      const context = createContext();
      mocks.getFileMock.mockReturnValue({
        fileId: "file-1",
        metadata: { "core.queryengine.jdbc.dialectId": "sqlserver" }
      });
      mocks.readViewStateMock.mockReturnValue({ includeActualPlan: true });
      coreQueryEngineJdbcSqlServerPlugin.activate(context);

      const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]![0];
      const result = provider({ engineId: "jdbc", fileId: "file-1", options: { intent: "plan.estimated" } });
      expect(result?.options?.intent).toBe("plan.estimated");
    });

    it("does not add actual plan when includeActualPlan is false", () => {
      const context = createContext();
      mocks.getFileMock.mockReturnValue({
        fileId: "file-1",
        metadata: { "core.queryengine.jdbc.dialectId": "sqlserver" }
      });
      mocks.readViewStateMock.mockReturnValue({ includeActualPlan: false });
      coreQueryEngineJdbcSqlServerPlugin.activate(context);

      const provider = mocks.registerExecutionContextProviderMock.mock.calls[0]![0];
      const result = provider({ engineId: "jdbc", fileId: "file-1" });
      expect(result?.options?.intent).toBeUndefined();
    });
  });
});
