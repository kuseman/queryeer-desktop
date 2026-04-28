import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";

const mocks = vi.hoisted(() => {
  const subscribeByExecutionId = new Map<string, (event: { method: string; params?: unknown }) => void>();
  const executeRequestListeners = new Set<() => void>();
  const cancelRequestListeners = new Set<() => void>();
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
    subscribeByExecutionId,
    executeRequestListeners,
    cancelRequestListeners
  };
});

vi.mock("../core.editor/TextEditor/TextEditorComponent", () => ({
  TextEditorComponent: () => <div data-testid="mock-editor" />
}));

vi.mock("./output/OutputPanel", () => ({
  OutputPanel: ({ context, selectedPrimaryId }: { context: { state: string }; selectedPrimaryId?: string | null }) => (
    <div
      data-testid="mock-output"
      data-state={context.state}
      data-selected-primary={selectedPrimaryId ?? ""}
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

import { QueryEditorComponent } from "./QueryEditorComponent";

void React;

function makeFile(overrides: Partial<FileEntity>): FileEntity {
  return {
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
    getFileStateRegistry().evict("file-1");
    getFileStateRegistry().evict("file-2");
    mocks.executeMock.mockResolvedValue("exec-1");

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
      root.render(<QueryEditorComponent file={file1} />);
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
      root.render(<QueryEditorComponent file={file2} />);
    });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} />);
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
      root.render(<QueryEditorComponent file={file1} />);
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
      root.render(<QueryEditorComponent file={file2} />);
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
      root.render(<QueryEditorComponent file={file1} />);
    });

  });

  it("temporarily switches active output to text when query fails", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} />);
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
      listener?.({ method: "query.failed", params: { error: { code: "E", message: "boom" } } });
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.text");
  });

  it("temporarily switches active output to text when query has no rows", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} />);
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
      listener?.({ method: "query.completed", params: { metrics: { rowCount: 0 }, features: ["rows"] } });
      await Promise.resolve();
    });

    const output = rootElement.querySelector('[data-testid="mock-output"]');
    expect(output?.getAttribute("data-selected-primary")).toBe("core.queryengine.output.text");
  });
});
