import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntity } from "../../contracts/files/FileEntity";

const mocks = vi.hoisted(() => {
  const subscribeByExecutionId = new Map<string, (event: { method: string; params?: unknown }) => void>();
  return {
    executeMock: vi.fn(async () => "exec-1"),
    cancelMock: vi.fn(async () => {}),
    subscribeMock: vi.fn((executionId: string, listener: (event: { method: string; params?: unknown }) => void) => {
      subscribeByExecutionId.set(executionId, listener);
      return () => {
        subscribeByExecutionId.delete(executionId);
      };
    }),
    onExecuteRequestMock: vi.fn(() => () => {}),
    onCancelRequestMock: vi.fn(() => () => {}),
    getActiveEditorMock: vi.fn(() => ({
      getSelectedText: () => undefined,
      getContent: () => "select 1"
    })),
    subscribeByExecutionId
  };
});

vi.mock("../core.editor/TextEditor/TextEditorComponent", () => ({
  TextEditorComponent: () => <div data-testid="mock-editor" />
}));

vi.mock("./output/OutputPanel", () => ({
  OutputPanel: ({ context }: { context: { state: string } }) => (
    <div data-testid="mock-output" data-state={context.state} />
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

    const clickRun = async () => {
      const runButton = [...rootElement.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Run")
      );
      expect(runButton).toBeTruthy();
      await act(async () => {
        runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
    };

    const getRunButton = () =>
      [...rootElement.querySelectorAll("button")].find((button) => button.textContent?.includes("Run"));

    const getStopButton = () =>
      [...rootElement.querySelectorAll("button")].find((button) => button.textContent?.includes("Stop"));

    await clickRun();

    expect(mocks.executeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: "file-1"
      })
    );
    expect(getRunButton()?.disabled).toBe(true);
    expect(getStopButton()?.disabled).toBe(false);

    await act(async () => {
      root.render(<QueryEditorComponent file={file2} />);
    });

    expect(getRunButton()?.disabled).toBe(false);
    expect(getStopButton()?.disabled).toBe(true);

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} />);
    });

    expect(getRunButton()?.disabled).toBe(true);
    expect(getStopButton()?.disabled).toBe(false);

    await act(async () => {
      getStopButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.cancelMock).toHaveBeenCalledWith("exec-1");
    expect(getRunButton()?.disabled).toBe(false);
    expect(getStopButton()?.disabled).toBe(true);
  });

  it("tracks concurrent executions per file across tab switches", async () => {
    const file1 = makeFile({ fileId: "file-1", uri: "file:///q1.sql" });
    const file2 = makeFile({ fileId: "file-2", uri: "file:///q2.sql" });

    mocks.executeMock.mockResolvedValueOnce("exec-1").mockResolvedValueOnce("exec-2");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} />);
    });

    const clickRun = async () => {
      const runButton = [...rootElement.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Run")
      );
      expect(runButton).toBeTruthy();
      await act(async () => {
        runButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
    };

    const clickStop = async () => {
      const stopButton = [...rootElement.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Stop")
      );
      expect(stopButton).toBeTruthy();
      await act(async () => {
        stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
    };

    const getRunButton = () =>
      [...rootElement.querySelectorAll("button")].find((button) => button.textContent?.includes("Run"));

    const getStopButton = () =>
      [...rootElement.querySelectorAll("button")].find((button) => button.textContent?.includes("Stop"));

    await clickRun();
    expect(mocks.executeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        fileId: "file-1"
      })
    );
    expect(getRunButton()?.disabled).toBe(true);
    expect(getStopButton()?.disabled).toBe(false);

    await act(async () => {
      root.render(<QueryEditorComponent file={file2} />);
    });

    expect(getRunButton()?.disabled).toBe(false);
    expect(getStopButton()?.disabled).toBe(true);

    await clickRun();
    expect(mocks.executeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        fileId: "file-2"
      })
    );
    expect(getRunButton()?.disabled).toBe(true);
    expect(getStopButton()?.disabled).toBe(false);

    await clickStop();
    expect(mocks.cancelMock).toHaveBeenCalledWith("exec-2");

    await act(async () => {
      root.render(<QueryEditorComponent file={file1} />);
    });

    expect(getRunButton()?.disabled).toBe(true);
    expect(getStopButton()?.disabled).toBe(false);
  });
});
