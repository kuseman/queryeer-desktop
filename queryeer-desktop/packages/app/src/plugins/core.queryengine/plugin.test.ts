import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryOutputArtifact } from "@queryeer/api/backend/Types";
import type { FileEntity } from "@queryeer/api/files/FileEntity";
import type { LayoutToolbarSelectContribution, TabHeaderStyleContribution } from "@queryeer/api/extensions/LayoutExtension";
import type { PluginContext } from "@queryeer/api/plugin/Plugin";
import { getQueryPlanArtifactStore } from "./query-plan/artifact-store";
import { QUERY_VIEW_STATE_KEY } from "./QueryViewStateStore";

const registerQueryPlanOutputMock = vi.hoisted(() => vi.fn());

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

vi.mock("../../core/plugin-runtime/ExtensionRegistry", () => ({
  getEditorRegistryHost: () => ({
    getActiveEditor: () => null,
    onActiveEditorChanged: () => ({ dispose: () => {} }),
    setActiveEditor: () => {},
    registerContentRepository: () => () => {},
    resolveFileContent: () => undefined,
    broadcastContentUpdate: () => {},
    applyRecoveredContent: () => {},
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

vi.mock("../core.commands/when-expression-variable-registry", () => ({
  registerWhenExpressionVariables: vi.fn()
}));

vi.mock("./symbol-action-provider", () => ({
  createSymbolActionProvider: vi.fn(() => ({ id: "core.queryengine.symbolActions", getItems: async () => [] }))
}));

vi.mock("./symbol-action-registry", () => ({
  getSymbolActionRegistry: vi.fn(() => ({ getSymbolActions: () => [], setActions: vi.fn(), onDidChangeActions: vi.fn() }))
}));

vi.mock("./symbol-action-settings", () => ({
  SymbolActionsSettingsEditor: vi.fn(() => null)
}));

vi.mock("../core.settings/service", () => ({
  onCoreSettingsServiceInitialized: vi.fn()
}));

vi.mock("./query-plan/output", () => ({
  registerQueryPlanOutput: registerQueryPlanOutputMock
}));

import { coreQueryEnginePlugin } from "./plugin";

function createArtifact(id: string, capability: string, graphId: string): QueryOutputArtifact {
  return {
    id,
    capability,
    kind: "graph",
    title: `${capability}-${id}`,
    graph: {
      id: graphId,
      vertices: [{ id: "v1", label: "Node" }],
      edges: []
    }
  };
}

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
    graphNodeTypes: { registerNodeType: vi.fn(), unregisterNodeType: vi.fn(), getComponent: vi.fn(), getAll: vi.fn(() => new Map()) },
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

describe("core.queryengine plugin", () => {
  beforeEach(() => {
    getQueryPlanArtifactStore().clear();
    registerQueryPlanOutputMock.mockReset();
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

    expect(registerQueryPlanOutputMock).toHaveBeenCalledWith(context);

    expect(mocks.registerEngineResolverMock).toHaveBeenCalledTimes(1);

    const registerEditorMock = context.layout.registerEditor as ReturnType<typeof vi.fn>;
    expect(registerEditorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.editor",
        supportedContentCategories: ["text"],
        requiredCapabilities: ["queryexecutable"],
        canSplit: true
      })
    );

    const editorContribution = registerEditorMock.mock.calls[0]?.[0] as
      | { render?: (context?: { activeFile?: FileEntity; editorInstanceId?: string; editorGroupId?: string; isActiveEditorGroup?: boolean }) => unknown }
      | undefined;
    expect(typeof editorContribution?.render).toBe("function");
    const renderResult = editorContribution?.render?.({
      activeFile: makeFile(),
      editorInstanceId: "group-1:core.queryengine.editor",
      editorGroupId: "group-1",
      isActiveEditorGroup: true
    }) as {
      props?: {
        editorInstanceId?: string;
        editorGroupId?: string;
        isActiveEditorGroup?: boolean;
      }
    } | undefined;
    expect(renderResult?.props?.editorInstanceId).toBe("group-1:core.queryengine.editor");
    expect(renderResult?.props?.editorGroupId).toBe("group-1");
    expect(renderResult?.props?.isActiveEditorGroup).toBe(true);

    const registerTabHeaderStyleMock = context.layout.registerTabHeaderStyle as ReturnType<typeof vi.fn>;
    expect(registerTabHeaderStyleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.tabHeaderStyle.execution"
      })
    );
  });

  it("styles only the file whose tab metadata is running in the rendered group", () => {
    const context = createContext(makeFile());
    coreQueryEnginePlugin.activate(context);

    const registerTabHeaderStyleMock = context.layout.registerTabHeaderStyle as ReturnType<typeof vi.fn>;
    const contribution = registerTabHeaderStyleMock.mock.calls.find(
      (call) => call[0]?.id === "core.queryengine.tabHeaderStyle.execution"
    )?.[0] as TabHeaderStyleContribution | undefined;
    expect(contribution).toBeDefined();

    const runningFile = makeFile({
      metadata: {
        "core.queryengine.tabStateByGroup": { "group-1": "running" }
      }
    });
    const siblingFile = makeFile({ fileId: "file-2", metadata: {} });
    const baseContext = {
      isActive: false,
      editorGroupId: "group-1",
      hasCapability: () => true
    };

    expect(contribution?.render({ ...baseContext, file: runningFile })).toMatchObject({
      className: "queryengine-tab-state-running",
      indicatorClassName: "queryengine-tab-indicator-running"
    });
    expect(contribution?.render({ ...baseContext, file: siblingFile })).toBeNull();
    expect(contribution?.render({ ...baseContext, editorGroupId: "group-2", file: runningFile })).toBeNull();
  });

  it("updates tab metadata from running to cleared on completion", () => {
    const file = makeFile();
    const context = createContext(file);
    coreQueryEnginePlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((event: { method: string; params?: { queryExecutionId?: string } }, executeContext?: { fileId?: string; targetOutputSessionId?: string }) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      { method: "query.started", params: { queryExecutionId: "q-1" } },
      { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" }
    );
    expect(context.files.updateFile).toHaveBeenCalledWith(
      "file-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          keep: true,
          "core.queryengine.tabStateByGroup": { "group-1": "running" },
          "core.queryengine.hasRunningQuery": true
        })
      })
    );

    listener?.({ method: "queryengine.completed", params: { queryExecutionId: "q-1" } }, { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" });
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
    expect(lastCallMetadata["core.queryengine.tabStateByGroup"]).toBeUndefined();
    expect(lastCallMetadata["core.queryengine.hasRunningQuery"]).toBeUndefined();
  });

  it("keeps failed tab metadata until next execution", () => {
    const file = makeFile();
    const context = createContext(file);
    coreQueryEnginePlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((event: { method: string; params?: { queryExecutionId?: string } }, executeContext?: { fileId?: string; targetOutputSessionId?: string }) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      { method: "query.started", params: { queryExecutionId: "q-2" } },
      { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" }
    );
    listener?.({ method: "queryengine.failed", params: { queryExecutionId: "q-2" } }, { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" });

    expect(context.files.updateFile).toHaveBeenLastCalledWith(
      "file-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          "core.queryengine.tabStateByGroup": { "group-1": "failed" }
        })
      })
    );
    const lastCallMetadata = (context.files.updateFile as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]
      ?.metadata as Record<string, unknown>;
    expect(lastCallMetadata["core.queryengine.hasRunningQuery"]).toBeUndefined();
  });

  it("marks tab as failed when execute preflight emits queryengine.failed", () => {
    const file = makeFile();
    const context = createContext(file);
    coreQueryEnginePlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((event: { method: string; params?: { queryExecutionId?: string } }, executeContext?: { fileId?: string; targetOutputSessionId?: string }) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      { method: "query.started", params: { queryExecutionId: "q-3" } },
      { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" }
    );
    listener?.({ method: "queryengine.failed", params: { queryExecutionId: "q-3" } }, { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" });

    expect(context.files.updateFile).toHaveBeenLastCalledWith(
      "file-1",
      expect.objectContaining({
        metadata: expect.objectContaining({
          "core.queryengine.tabStateByGroup": { "group-1": "failed" }
        })
      })
    );
    const lastCallMetadata = (context.files.updateFile as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]
      ?.metadata as Record<string, unknown>;
    expect(lastCallMetadata["core.queryengine.hasRunningQuery"]).toBeUndefined();
  });

it("marks backend-dependent commands with backendHealthy enablement", () => {
    const context = createContext(makeFile());
    coreQueryEnginePlugin.activate(context);

    const registerCommandMock = context.commands.registerCommand as ReturnType<typeof vi.fn>;
    expect(registerCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.execute",
        enablement: "backendHealthy && hasActiveQueryExecutableFile && activeFile?.metadata?.core?.queryengine?.hasRunningQuery != true"
      })
    );
    expect(registerCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.cancel",
        enablement: "backendHealthy && hasActiveQueryExecutableFile && activeFile?.metadata?.core?.queryengine?.hasRunningQuery == true"
      })
    );

    const registerKeybindingMock = context.keybindings.registerKeybinding as ReturnType<typeof vi.fn>;
    expect(registerKeybindingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.keybinding.execute",
        key: "F5",
        when: "global",
        scope: "global"
      })
    );
  });

  it("registers output and text format toolbar select contributions", () => {
    const context = createContext(makeFile());

    coreQueryEnginePlugin.activate(context);

    const registerToolbarActionMock = context.layout.registerToolbarAction as ReturnType<typeof vi.fn>;
    expect(registerToolbarActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.toolbar.output.select",
        type: "select",
        when: "hasActiveQueryExecutableFile"
      })
    );
    expect(registerToolbarActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "core.queryengine.toolbar.output.text.format",
        type: "select",
        when: "hasActiveQueryExecutableFile"
      })
    );
  });

  it("stores toolbar output selection under the active editor group session", () => {
    const file = makeFile();
    const context = createContext(file);
    coreQueryEnginePlugin.activate(context);

    const registerToolbarActionMock = context.layout.registerToolbarAction as ReturnType<typeof vi.fn>;
    const outputSelect = registerToolbarActionMock.mock.calls
      .map((call) => call[0])
      .find((action) => action.id === "core.queryengine.toolbar.output.select") as LayoutToolbarSelectContribution | undefined;
    expect(outputSelect).toBeDefined();

    outputSelect?.onChange("core.queryengine.output.text", {
      activeFile: file,
      activeEditorGroupId: "group-2",
      editorGroupCount: 2,
      hasMultipleEditorGroups: true
    });

    const latestFile = context.files.getFile("file-1") as FileEntity;
    const persisted = latestFile.persistentViewState?.[QUERY_VIEW_STATE_KEY] as {
      version: number;
      sessions: Record<string, { executionTargetOutputId?: string }>;
    };

    expect(persisted.version).toBe(2);
    expect(persisted.sessions["core.queryengine:group-2"]?.executionTargetOutputId).toBe("core.queryengine.output.text");
    expect(persisted.sessions["core.queryengine:group-1"]).toBeUndefined();
  });

  it("stores plan artifacts on completion and prunes stale files", () => {
    const context = createContext(makeFile());
    coreQueryEnginePlugin.activate(context);

    const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
      | ((event: { method: string; params?: { queryExecutionId?: string; artifacts?: unknown[] } }, executeContext?: { fileId?: string }) => void)
      | undefined;
    expect(listener).toBeTypeOf("function");

    listener?.(
      { method: "query.started", params: { queryExecutionId: "q-plan-1" } },
      { fileId: "file-1" }
    );
    listener?.({
      method: "queryengine.completed",
      params: {
        queryExecutionId: "q-plan-1",
        artifacts: [
          createArtifact("rows-1", "rows", "rows-graph"),
          createArtifact("plan-1", "plan", "plan-graph")
        ]
      }
    }, {});

    const store = getQueryPlanArtifactStore();
    expect(store.list("file-1").map((artifact) => artifact.id)).toEqual(["plan-1"]);

    store.rememberArtifacts("file-zombie", [createArtifact("plan-z", "plan", "graph-z")]);
    expect(store.list("file-zombie").map((artifact) => artifact.id)).toEqual(["plan-z"]);

    const filesSubscription = (context.files.subscribe as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
      | ((files: FileEntity[]) => void)
      | undefined;
    expect(filesSubscription).toBeTypeOf("function");
    filesSubscription?.([makeFile({ fileId: "file-1" })]);

expect(store.list("file-zombie")).toEqual([]);
    expect(store.list("file-1").map((artifact) => artifact.id)).toEqual(["plan-1"]);
  });

  describe("split pane tab indicator isolation", () => {
    it("only marks tab as running for the session that started the query", () => {
      const file = makeFile();
      const context = createContext(file);
      coreQueryEnginePlugin.activate(context);

      const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
        | ((event: { method: string; params?: { queryExecutionId?: string } }, executeContext?: { fileId?: string; targetOutputSessionId?: string }) => void)
        | undefined;
      expect(listener).toBeTypeOf("function");

      listener?.(
        { method: "query.started", params: { queryExecutionId: "q-split-1" } },
        { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" }
      );

      expect(context.files.updateFile).toHaveBeenCalledWith(
        "file-1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            "core.queryengine.tabStateByGroup": { "group-1": "running" }
          })
        })
      );

      const group2StartCall = (context.files.updateFile as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) =>
          call[1]?.metadata?.["core.queryengine.tabStateByGroup"]?.["group-2"] === "running"
      );
      expect(group2StartCall).toBeUndefined();
    });

    it("preserves tab state in one group when another group completes", () => {
      const file = makeFile();
      const context = createContext(file);
      coreQueryEnginePlugin.activate(context);

      const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
        | ((event: { method: string; params?: { queryExecutionId?: string } }, executeContext?: { fileId?: string; targetOutputSessionId?: string }) => void)
        | undefined;
      expect(listener).toBeTypeOf("function");

      listener?.(
        { method: "query.started", params: { queryExecutionId: "q-split-1" } },
        { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" }
      );
      listener?.(
        { method: "query.started", params: { queryExecutionId: "q-split-2" } },
        { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-2" }
      );

      expect(context.files.updateFile).toHaveBeenCalledWith(
        "file-1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            "core.queryengine.tabStateByGroup": { "group-1": "running", "group-2": "running" }
          })
        })
      );

      listener?.(
        { method: "queryengine.completed", params: { queryExecutionId: "q-split-1" } },
        { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" }
      );

      expect(context.files.updateFile).toHaveBeenLastCalledWith(
        "file-1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            "core.queryengine.tabStateByGroup": { "group-2": "running" }
          })
        })
      );
    });

    it("marks only the failed group's tab state to failed", () => {
      const file = makeFile();
      const context = createContext(file);
      coreQueryEnginePlugin.activate(context);

      const listener = mocks.onQueryEventMock.mock.calls[0]?.[0] as
        | ((event: { method: string; params?: { queryExecutionId?: string } }, executeContext?: { fileId?: string; targetOutputSessionId?: string }) => void)
        | undefined;
      expect(listener).toBeTypeOf("function");

      listener?.(
        { method: "query.started", params: { queryExecutionId: "q-split-1" } },
        { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" }
      );
      listener?.(
        { method: "query.started", params: { queryExecutionId: "q-split-2" } },
        { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-2" }
      );

      (context.files.updateFile as ReturnType<typeof vi.fn>).mockClear();

      listener?.(
        { method: "queryengine.failed", params: { queryExecutionId: "q-split-1" } },
        { fileId: "file-1", targetOutputSessionId: "core.queryengine:group-1" }
      );

      expect(context.files.updateFile).toHaveBeenCalledWith(
        "file-1",
        expect.objectContaining({
          metadata: expect.objectContaining({
            "core.queryengine.tabStateByGroup": { "group-1": "failed", "group-2": "running" }
          })
        })
      );
    });
  });
});
