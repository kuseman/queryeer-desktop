import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { QueryExecuteOptions } from "../../contracts/backend/Types";
import type { ContentCategory } from "../../contracts/files/FilesRegistry";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import type { OutputContext } from "../../contracts/queryengine/OutputExtension";
import { defineStateKey } from "../../contracts/files/FileStateRegistry";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import { getQueryViewStateStore } from "./QueryViewStateStore";

const mocks = vi.hoisted(() => {
  type ActiveEditorMock = {
    getSelectedText?: () => string | undefined;
    getContent?: () => string;
    getSelection?: () => {
      selectionStartLineNumber: number;
      selectionStartColumn: number;
      positionLineNumber: number;
      positionColumn: number;
    } | null;
  };
  const subscribeByExecutionId = new Map<string, (event: { method: string; params?: unknown }) => void>();
  const executeRequestListeners = new Set<() => void>();
  const cancelRequestListeners = new Set<() => void>();
  const toggleOutputPanelRequestListeners = new Set<() => void>();
  const selectedPrimaryRef = { value: "core.queryengine.output.table" as string | null };
  return {
    executeMock: vi.fn(async () => "exec-1"),
    consumeExecuteOptionsMock: vi.fn(() => null as { outputIdOverride?: string; optionsOverride?: QueryExecuteOptions } | null),
    peekExecuteOptionsMock: vi.fn(() => null as { fileIdOverride?: string } | null),
    cancelMock: vi.fn(async () => {}),
    ensureUnlockedForSecretAccessMock: vi.fn(async () => true),
    notifyExecutionStartMock: vi.fn(),
    subscribeMock: vi.fn((executionId: string, listener: (event: { method: string; params?: unknown }) => void) => {
      subscribeByExecutionId.set(executionId, listener);
      return () => {
        subscribeByExecutionId.delete(executionId);
      };
    }),
    onExecuteRequestMock: vi.fn((listener: () => void) => {
      executeRequestListeners.add(listener);
      return () => executeRequestListeners.delete(listener);
    }),
    onCancelRequestMock: vi.fn((listener: () => void) => {
      cancelRequestListeners.add(listener);
      return () => cancelRequestListeners.delete(listener);
    }),
    onToggleOutputPanelRequestMock: vi.fn((listener: () => void) => {
      toggleOutputPanelRequestListeners.add(listener);
      return () => toggleOutputPanelRequestListeners.delete(listener);
    }),
    getActiveEditorMock: vi.fn<() => ActiveEditorMock>(() => ({
      getSelectedText: () => "",
      getContent: () => "select 1",
      getSelection: () => null
    })),
    selectedPrimaryRef,
    subscribeByExecutionId,
    executeRequestListeners,
    cancelRequestListeners,
    toggleOutputPanelRequestListeners,
  };
});

vi.mock("../core.editor/texteditor/TextEditorComponent", () => ({
  TextEditorComponent: () => <div data-testid="mock-editor" />
}));

vi.mock("./output/OutputPanel", () => ({
  OutputPanel: ({
    context,
    selectedPrimaryId,
    onSelectPrimary
  }: {
    context: { state: string; textOutputFormat?: string; rowsTargetPrimaryId?: string | null };
    selectedPrimaryId?: string | null;
    onSelectPrimary?: (id: string) => void;
  }) => (
    <div
      data-testid="mock-output"
      data-state={context.state}
      data-selected-primary={selectedPrimaryId ?? ""}
      data-text-format={context.textOutputFormat ?? ""}
      data-rows-target-primary={context.rowsTargetPrimaryId ?? ""}
      data-has-select-callback={onSelectPrimary ? "true" : "false"}
    />
  )
}));

vi.mock("./QueryTextEditorRegistry", () => ({
  queryTextRegistry: {
    getActiveEditor: () => mocks.getActiveEditorMock()
  }
}));

vi.mock("./QueryEngineService", () => ({
  getQueryEngineService: () => ({
    execute: mocks.executeMock,
    cancel: mocks.cancelMock,
    subscribe: mocks.subscribeMock,
    onExecuteRequest: mocks.onExecuteRequestMock,
    onCancelRequest: mocks.onCancelRequestMock,
    onToggleOutputPanelRequest: mocks.onToggleOutputPanelRequestMock,
    consumeExecuteOptions: mocks.consumeExecuteOptionsMock,
    peekExecuteOptions: mocks.peekExecuteOptionsMock
  })
}));

vi.mock("../core.security/service", () => ({
  getCoreSecurityService: () => ({
    ensureUnlockedForSecretAccess: mocks.ensureUnlockedForSecretAccessMock
  })
}));

vi.mock("./output/OutputRegistry", () => ({
  getOutputRegistry: () => ({
    setSelectedPrimary: (id: string | null) => {
      mocks.selectedPrimaryRef.value = id;
    },
    getSelectedPrimaryId: () => mocks.selectedPrimaryRef.value,
    notifyChunkRows: vi.fn(),
    notifyExecutionStart: mocks.notifyExecutionStartMock,
    getContributors: () => [],
    getSelectablePrimaryContributors: () => [
      { id: "core.queryengine.output.table", mode: "primary", capability: "rows", title: "Results", render: () => null },
      { id: "core.queryengine.output.text", mode: "primary", capability: "rows", title: "Text", render: () => null }
    ],
    subscribe: () => () => {}
  })
}));

import { QueryEditorComponent } from "./QueryEditorComponent";
import type { EditorRegistryHost } from "../../contracts/editor/EditorCapability";
import type { OutlineRegistry } from "../../contracts/extensions/OutlineExtension";

void React;

const mockEditorRegistryHost: EditorRegistryHost = {
  getActiveEditor: () => {
    const editor = mocks.getActiveEditorMock();
    if (!editor) return null;
    return {
      editorId: "test",
      fileId: "file-1",
      focus: { focus: () => {} },
      selection: {
        getSelectedText: () => editor.getSelectedText?.() ?? null,
        getContent: () => editor.getContent?.() ?? "",
        getSelection: () => editor.getSelection?.() ?? null
      }
    };
  },
  onActiveEditorChanged: () => ({ dispose: () => {} }),
  setActiveEditor: () => {},
  registerContentRepository: () => () => {},
  resolveFileContent: () => undefined,
  broadcastContentUpdate: () => {},
  applyRecoveredContent: () => {},
  onContentDirty: () => () => {}
};

const mockOutlineRegistry: OutlineRegistry = {
  registerOutlineProvider: () => {},
  registerSupplementaryOutlineProvider: () => {},
  hasProvider: () => false,
  getProvider: () => undefined,
  getSymbols: async () => []
};

const queryFilesById = new Map<string, FileEntity>();
const OUTPUT_CONTEXT_KEY = defineStateKey<OutputContext>("core.queryengine.outputContext");

function makeFile(overrides: Partial<FileEntity>): FileEntity {
  const file: FileEntity = {
    fileId: "file-1",
    uri: "file:///test.sql",
    mimeType: "application/sql",
    dirtyVsBackend: false,
    dirtyVsDisk: false,
    diskState: "inSync",
    version: 1,
    openedAt: new Date().toISOString(),
    ...overrides
  };
  queryFilesById.set(file.fileId, file);
  return file;
}

describe("QueryEditorComponent execution state across tab switches", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.executeMock.mockReset();
    mocks.consumeExecuteOptionsMock.mockReset();
    mocks.consumeExecuteOptionsMock.mockReturnValue(null);
    mocks.cancelMock.mockReset();
    mocks.subscribeMock.mockClear();
    mocks.onExecuteRequestMock.mockClear();
    mocks.onCancelRequestMock.mockClear();
    mocks.notifyExecutionStartMock.mockClear();
    mocks.ensureUnlockedForSecretAccessMock.mockReset();
    mocks.ensureUnlockedForSecretAccessMock.mockResolvedValue(true);
    mocks.getActiveEditorMock.mockClear();
    mocks.subscribeByExecutionId.clear();
    mocks.executeRequestListeners.clear();
    mocks.cancelRequestListeners.clear();
    mocks.toggleOutputPanelRequestListeners.clear();
    mocks.selectedPrimaryRef.value = "core.queryengine.output.table";
    queryFilesById.clear();
    getQueryViewStateStore().evict("file-1");
    getQueryViewStateStore().evict("file-2");
    getQueryViewStateStore().evict("file-plan");
    getFileStateRegistry().evict("file-1");
    getFileStateRegistry().evict("file-2");
    mocks.executeMock.mockResolvedValue("exec-1");

const filesRegistry = {
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
        getContentCategory: vi.fn(() => "text" as ContentCategory)
      },
      mimeIcons: {
        registerMimeIcon: vi.fn(),
        getMimeIcon: vi.fn(),
        listMimeIcons: vi.fn(() => [])
      },
      openFile: vi.fn(),
      closeFile: vi.fn(),
      getFile: (fileId: string) => queryFilesById.get(fileId),
      listFiles: () => [...queryFilesById.values()],
      updateFile: (fileId: string, update: Partial<FileEntity>) => {
        const existing = queryFilesById.get(fileId);
        if (!existing) {
          return undefined;
        }
        const next = { ...existing, ...update };
        queryFilesById.set(fileId, next);
        return next;
      },
      subscribe: vi.fn(() => () => {}),
      registerMimeResolver: vi.fn(),
      registerEditorResolver: vi.fn(),
      classifyUri: vi.fn(),
      resolveEditor: vi.fn(),
      getEditorState: vi.fn(),
      setEditorState: vi.fn(),
      markDirty: vi.fn()
    } satisfies FilesRegistry;

    getQueryViewStateStore().initialize(filesRegistry);

    const appShell = ((window as unknown as { appShell?: Record<string, unknown> }).appShell ??= {});
    (appShell as { finalizeExportStream?: () => Promise<{ exportPath: string }> }).finalizeExportStream ??= async () => ({ exportPath: "C:/tmp/export.csv" });
    (appShell as { openPath?: () => Promise<{ accepted: boolean }> }).openPath ??= async () => ({ accepted: true });

    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
  });

  it("defaults new query files to table results output", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    mocks.selectedPrimaryRef.value = null;

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    const output = rootElement.querySelector("[data-testid='mock-output']");
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.table");
    expect(output?.getAttribute("data-rows-target-primary")).toBe("core.queryengine.output.table");

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const context = getFileStateRegistry().get("file-1", OUTPUT_CONTEXT_KEY);
    expect(context?.rowsTargetPrimaryId).toBe("core.queryengine.output.table");
  });

  it("keeps stop wired to running execution after switching tabs", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    const file2 = makeFile({ fileId: "file-2", uri: "file:///q2.sql" });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    expect(mocks.executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "file-1"
      })
    );
    await act(async () => {
      root.render(<QueryEditorComponent file={file2} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.cancelRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    expect(mocks.cancelMock).toHaveBeenCalledWith("exec-1");
  });

  it("passes one-shot execution option overrides to the query engine", async () => {
    const file = makeFile({ fileId: "file-plan", uri: "file:///plan.sql" });
    // Mount-time consumeExecuteOptions check must return null
    mocks.consumeExecuteOptionsMock.mockReturnValueOnce(null);
    mocks.consumeExecuteOptionsMock.mockReturnValueOnce({
      optionsOverride: {
        intent: "plan.estimated",
        requestedArtifacts: [{ capability: "plan", kind: "graph" }]
      }
    });

    await act(async () => {
      root.render(<QueryEditorComponent file={file} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    expect(mocks.executeMock).toHaveBeenCalledWith(expect.objectContaining({
      fileId: "file-plan",
      options: {
        intent: "plan.estimated",
        requestedArtifacts: [{ capability: "plan", kind: "graph" }]
      }
    }));
  });

  it("tracks concurrent executions per file across tab switches", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    const file2 = makeFile({ fileId: "file-2", uri: "file:///q2.sql" });

    mocks.executeMock.mockResolvedValueOnce("exec-1").mockResolvedValueOnce("exec-2");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });
    expect(mocks.executeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fileId: "file-1"
      })
    );
    await act(async () => {
      root.render(<QueryEditorComponent file={file2} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });
    expect(mocks.executeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fileId: "file-2"
      })
    );
    await act(async () => {
      for (const listener of mocks.cancelRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });
    expect(mocks.cancelMock).toHaveBeenCalledWith("exec-2");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

  });

  it("temporarily switches active output to text when query fails", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    expect(mocks.subscribeMock).toHaveBeenCalled();
    const listener = [...mocks.subscribeByExecutionId.values()][0];
    expect(listener).toBeTruthy();

    await act(async () => {
      listener?.({ method: "queryengine.failed", params: { error: { code: "E", message: "boom" } } });
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.text");
  });

  it("retries at most once after SECURITY_SESSION_CLOSED", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    mocks.executeMock.mockResolvedValueOnce("exec-1").mockResolvedValueOnce("exec-2");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const firstListener = mocks.subscribeByExecutionId.get("exec-1");
    expect(firstListener).toBeTruthy();

    await act(async () => {
      firstListener?.({ method: "queryengine.failed", params: { error: { code: "SECURITY_SESSION_CLOSED", message: "locked" } } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.executeMock).toHaveBeenCalledTimes(2);

    const secondListener = mocks.subscribeByExecutionId.get("exec-2");
    expect(secondListener).toBeTruthy();

    await act(async () => {
      secondListener?.({ method: "queryengine.failed", params: { error: { code: "SECURITY_SESSION_CLOSED", message: "still locked" } } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.executeMock).toHaveBeenCalledTimes(2);
    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-state")).toBe("failed");
  });

  it("does not stay running while SECURITY_SESSION_CLOSED unlock is pending", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    mocks.executeMock.mockResolvedValueOnce("exec-1").mockResolvedValueOnce("exec-2");

    let resolveUnlock: ((accepted: boolean) => void) | undefined;
    mocks.ensureUnlockedForSecretAccessMock.mockImplementationOnce(
      () => new Promise<boolean>((resolve) => {
        resolveUnlock = resolve;
      })
    );

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const firstListener = mocks.subscribeByExecutionId.get("exec-1");
    expect(firstListener).toBeTruthy();

    await act(async () => {
      firstListener?.({ method: "queryengine.failed", params: { error: { code: "SECURITY_SESSION_CLOSED", message: "locked" } } });
      await Promise.resolve();
    });

    let output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-state")).toBe("failed");
    expect(mocks.executeMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveUnlock?.(true);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.ensureUnlockedForSecretAccessMock).toHaveBeenCalledTimes(1);
    expect(mocks.executeMock).toHaveBeenCalledTimes(2);
    output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-state")).toBe("running");
  });

  it("preserves one-shot execute options when retrying after SECURITY_SESSION_CLOSED", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    const executeOptions = {
      outputIdOverride: "core.graph.queryPlanOutput",
      optionsOverride: {
        intent: "plan.estimated" as const,
        requestedArtifacts: [{ capability: "plan" as const, kind: "graph" as const }]
      }
    };
    mocks.consumeExecuteOptionsMock.mockReturnValueOnce(null); // mount-time check
    mocks.consumeExecuteOptionsMock.mockReturnValueOnce(executeOptions);
    mocks.executeMock.mockResolvedValueOnce("exec-1").mockResolvedValueOnce("exec-2");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const firstListener = mocks.subscribeByExecutionId.get("exec-1");
    await act(async () => {
      firstListener?.({ method: "queryengine.failed", params: { error: { code: "SECURITY_SESSION_CLOSED", message: "locked" } } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.executeMock).toHaveBeenCalledTimes(2);
    expect(mocks.executeMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ options: executeOptions.optionsOverride }));
    expect(mocks.executeMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ options: executeOptions.optionsOverride }));
    // Called once on mount (fileId check) and once from handleExecute
    expect(mocks.consumeExecuteOptionsMock).toHaveBeenCalledTimes(2);
  });

  it("marks execution failed when SECURITY_SESSION_CLOSED retry unlock is rejected", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    mocks.executeMock.mockResolvedValueOnce("exec-1");
    mocks.ensureUnlockedForSecretAccessMock.mockResolvedValueOnce(false);

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const firstListener = mocks.subscribeByExecutionId.get("exec-1");
    expect(firstListener).toBeTruthy();

    await act(async () => {
      firstListener?.({ method: "queryengine.failed", params: { error: { code: "SECURITY_SESSION_CLOSED", message: "locked" } } });
      await Promise.resolve();
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-state")).toBe("failed");
    expect(mocks.cancelMock).not.toHaveBeenCalled();
  });

  it("cancels cleanly when cancel is requested while execution start is pending", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    let resolveExecute: ((executionId: string) => void) | undefined;
    mocks.executeMock.mockImplementationOnce(
      () => new Promise<string>((resolve) => {
        resolveExecute = resolve;
      })
    );

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    await act(async () => {
      for (const listener of mocks.cancelRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    let output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-state")).toBe("cancelled");

    await act(async () => {
      resolveExecute?.("exec-pending");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.cancelMock).toHaveBeenCalledWith("exec-pending");
    expect(mocks.subscribeByExecutionId.has("exec-pending")).toBe(false);

    output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-state")).toBe("cancelled");
  });

  it("keeps default results tab when query has no rows", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    expect(mocks.subscribeMock).toHaveBeenCalled();
    const listener = [...mocks.subscribeByExecutionId.values()][0];
    expect(listener).toBeTruthy();

    await act(async () => {
      listener?.({ method: "queryengine.completed", params: { metrics: { rowCount: 0 }, features: ["rows"] } });
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.table");
  });

  it("tab selection is independent from toolbar output selection", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    getQueryViewStateStore().setSelectedOutput("file-1", "core.queryengine.output.table");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const listener = [...mocks.subscribeByExecutionId.values()][0];
    await act(async () => {
      listener?.({ method: "queryengine.failed", params: { error: { code: "E", message: "boom" } } });
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.text");

    expect(getQueryViewStateStore().read("file-1").selectedOutputId).toBe("core.queryengine.output.table");
  });

  it("does not switch panel tab when toolbar output selection changes", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    getQueryViewStateStore().setPanelSelectedOutput("file-1", "core.queryengine.output.table");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    let output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.table");

    await act(async () => {
      getQueryViewStateStore().setSelectedOutput("file-1", "core.queryengine.output.text");
      await Promise.resolve();
    });

    output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.table");
  });

  it("keeps toolbar-selected text format when executing", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    getQueryViewStateStore().setTextOutputFormat("file-1", "json");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    let output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-text-format")).toBe("json");

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-state")).toBe("running");
    expect(output?.getAttribute("data-text-format")).toBe("json");
  });

  it("uses toolbar-selected output when executing rows", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      getQueryViewStateStore().setPanelSelectedOutput("file-1", "core.queryengine.output.table");
      getQueryViewStateStore().setSelectedOutput("file-1", "core.queryengine.output.text");
      await Promise.resolve();
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const listener = [...mocks.subscribeByExecutionId.values()][0];
    await act(async () => {
      listener?.({
        method: "queryengine.chunkStart",
        params: {
          resultSetIndex: 0,
          schema: { columns: [{ name: "id", type: "int" }] }
        }
      });
      listener?.({
        method: "queryengine.chunkRows",
        params: {
          resultSetIndex: 0,
          rows: [[1], [2]]
        }
      });
      listener?.({
        method: "queryengine.completed",
        params: {
          metrics: { rowCount: 2, durationMs: 10 },
          features: ["rows"]
        }
      });
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.text");
  });

  it("selects toolbar output when executing after manually switching output tab", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    mocks.selectedPrimaryRef.value = "core.queryengine.output.table";

    getQueryViewStateStore().setPanelSelectedOutput("file-1", "core.queryengine.output.text");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    let output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.text");

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.table");
    expect(output?.getAttribute("data-rows-target-primary")).toBe("core.queryengine.output.table");
  });

  it("does not accumulate table rows in output context", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const listener = [...mocks.subscribeByExecutionId.values()][0];
    await act(async () => {
      listener?.({
        method: "queryengine.chunkStart",
        params: {
          resultSetIndex: 0,
          schema: { columns: [{ name: "id", type: "int" }] }
        }
      });
      listener?.({
        method: "queryengine.chunkRows",
        params: {
          resultSetIndex: 0,
          rows: [[1], [2]]
        }
      });
      await Promise.resolve();
    });

    const context = getFileStateRegistry().get("file-1", OUTPUT_CONTEXT_KEY);
    expect(context?.resultSets[0]?.rows).toEqual([]);
    expect(context?.resultSets[0]?.rowCount).toBe(2);
    expect(context?.fetchedRowCount).toBe(2);
    expect(mocks.notifyExecutionStartMock).toHaveBeenCalledWith({ fileId: "file-1" }, "core.queryengine.output.table");
  });

  it("selects plan tab without routing row chunks to the plan output", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    mocks.consumeExecuteOptionsMock.mockReturnValueOnce(null); // mount-time check
    mocks.consumeExecuteOptionsMock.mockReturnValueOnce({
      outputIdOverride: "core.graph.queryPlanOutput",
      optionsOverride: {
        intent: "plan.estimated",
        requestedArtifacts: [{ capability: "plan", kind: "graph" }]
      }
    });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.graph.queryPlanOutput");
    expect(output?.getAttribute("data-rows-target-primary")).toBe("core.queryengine.output.table");
  });

  it("selects plan tab over toolbar-selected output when plan is returned", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    getQueryViewStateStore().setSelectedOutput("file-1", "core.queryengine.output.text");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const listener = [...mocks.subscribeByExecutionId.values()][0];
    await act(async () => {
      listener?.({
        method: "queryengine.completed",
        params: {
          features: ["rows"],
          artifacts: [{ capability: "plan", kind: "graph", title: "Actual plan" }]
        }
      });
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.graph.queryPlanOutput");
    expect(output?.getAttribute("data-rows-target-primary")).toBe("core.queryengine.output.text");
  });

  it("preserves output tab selection separately from toolbar selection across active file switches", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    const file2 = makeFile({ fileId: "file-2", uri: "file:///q2.sql" });

    getQueryViewStateStore().setSelectedOutput("file-1", "core.queryengine.output.table");
    getQueryViewStateStore().setPanelSelectedOutput("file-1", "core.queryengine.output.text");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    let output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.text");

    await act(async () => {
      root.render(<QueryEditorComponent file={file2} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.table");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.text");
    expect(getQueryViewStateStore().read("file-1").selectedOutputId).toBe("core.queryengine.output.table");
  });

  it("does not persist output selection when switching output tabs", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    getQueryViewStateStore().setSelectedOutput("file-1", "core.queryengine.output.text");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-has-select-callback")).toBe("true");
    expect(getQueryViewStateStore().read("file-1").selectedOutputId).toBe("core.queryengine.output.text");
  });

  it("stores graph artifacts from completed query events", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const listener = [...mocks.subscribeByExecutionId.values()][0];
    await act(async () => {
      listener?.({
        method: "queryengine.completed",
        params: {
          metrics: { rowCount: 0, durationMs: 10 },
          features: ["plan"],
          artifacts: [
            {
              id: "plan-1",
              capability: "plan",
              kind: "graph",
              title: "Plan",
              graph: {
                id: "graph-1",
                vertices: [{ id: "select", label: "SELECT" }],
                edges: []
              }
            }
          ]
        }
      });
      await Promise.resolve();
    });

    const context = getFileStateRegistry().get("file-1", OUTPUT_CONTEXT_KEY);
    expect(context?.features).toEqual(["plan"]);
    expect(context?.artifacts).toHaveLength(1);
    expect(context?.artifacts[0]?.graph.vertices[0]?.label).toBe("SELECT");
  });

  it("selects the plan tab when actual plan execution returns a graph artifact", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const listener = [...mocks.subscribeByExecutionId.values()][0];
    await act(async () => {
      listener?.({
        method: "queryengine.completed",
        params: {
          metrics: { rowCount: 1, durationMs: 10 },
          features: ["rows", "plan"],
          artifacts: [
            {
              id: "plan-1",
              capability: "plan",
              kind: "graph",
              title: "Plan",
              graph: {
                id: "graph-1",
                vertices: [{ id: "select", label: "SELECT" }],
                edges: []
              }
            }
          ]
        }
      });
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.graph.queryPlanOutput");
  });

  it("maps failed error line to absolute editor line using execution selection anchor", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    mocks.getActiveEditorMock.mockReturnValue({
      getSelectedText: () => "select x",
      getContent: () => "select 1",
      getSelection: () => ({
        selectionStartLineNumber: 10,
        selectionStartColumn: 3,
        positionLineNumber: 12,
        positionColumn: 8
      })
    });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} editorRegistryHost={mockEditorRegistryHost} outlineRegistry={mockOutlineRegistry} />);
    });

    await act(async () => {
      for (const listener of mocks.executeRequestListeners) {
        listener();
      }
      await Promise.resolve();
    });

    const listener = [...mocks.subscribeByExecutionId.values()][0];
    await act(async () => {
      listener?.({
        method: "queryengine.failed",
        params: { error: { code: "INTERNAL", message: "boom", details: { line: 2, column: 4 } } }
      });
      await Promise.resolve();
    });

    const context = getFileStateRegistry().get("file-1", OUTPUT_CONTEXT_KEY);
    expect(context).toBeDefined();
    expect(context!.error?.details?.line).toBe(11);
    expect(context!.error?.details?.column).toBe(4);
  });

});
