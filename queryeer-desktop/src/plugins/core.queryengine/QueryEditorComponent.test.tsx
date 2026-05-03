import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";
import type { ContentCategory } from "../../contracts/files/FilesRegistry";
import type { FilesRegistry } from "../../contracts/files/FilesRegistry";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import { getQueryViewStateStore } from "./QueryViewStateStore";

const mocks = vi.hoisted(() => {
  const subscribeByExecutionId = new Map<string, (event: { method: string; params?: unknown }) => void>();
  const executeRequestListeners = new Set<() => void>();
  const cancelRequestListeners = new Set<() => void>();
  const selectedPrimaryRef = { value: "core.queryengine.output.table" as string | null };
  return {
    executeMock: vi.fn(async () => "exec-1"),
    cancelMock: vi.fn(async () => {}),
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
    getActiveEditorMock: vi.fn(() => ({
      getSelectedText: () => undefined,
      getContent: () => "select 1"
    })),
    selectedPrimaryRef,
    subscribeByExecutionId,
    executeRequestListeners,
    cancelRequestListeners
  };
});

vi.mock("../core.editor/TextEditor/TextEditorComponent", () => ({
  TextEditorComponent: () => <div data-testid="mock-editor" />
}));

vi.mock("./output/OutputPanel", () => ({
  OutputPanel: ({
    context,
    selectedPrimaryId,
    onSelectPrimary
  }: {
    context: { state: string; textOutputFormat?: string };
    selectedPrimaryId?: string | null;
    onSelectPrimary?: (id: string) => void;
  }) => (
    <div
      data-testid="mock-output"
      data-state={context.state}
      data-selected-primary={selectedPrimaryId ?? ""}
      data-text-format={context.textOutputFormat ?? ""}
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
    onCancelRequest: mocks.onCancelRequestMock
  })
}));

vi.mock("./output/OutputRegistry", () => ({
  getOutputRegistry: () => ({
    setSelectedPrimary: (id: string | null) => {
      mocks.selectedPrimaryRef.value = id;
    },
    getSelectedPrimaryId: () => mocks.selectedPrimaryRef.value,
    notifyChunkRows: vi.fn(),
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
        getContent: () => editor.getContent?.() ?? ""
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
    mocks.cancelMock.mockReset();
    mocks.subscribeMock.mockClear();
    mocks.onExecuteRequestMock.mockClear();
    mocks.onCancelRequestMock.mockClear();
    mocks.getActiveEditorMock.mockClear();
    mocks.subscribeByExecutionId.clear();
    mocks.executeRequestListeners.clear();
    mocks.cancelRequestListeners.clear();
    mocks.selectedPrimaryRef.value = "core.queryengine.output.table";
    queryFilesById.clear();
    getFileStateRegistry().evict("file-1");
    getFileStateRegistry().evict("file-2");
    mocks.executeMock.mockResolvedValue("exec-1");

const filesRegistry = {
      capabilities: {
        registerCapabilities: vi.fn(),
        hasCapability: vi.fn(() => true),
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

  it("temporarily switches active output to text when query has no rows", async () => {
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
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.text");
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
});
