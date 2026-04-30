import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputContributor, OutputContext } from "../../contracts/extensions/OutputExtension";

const mocks = vi.hoisted(() => {
  const terminals: Array<{
    selectAll: ReturnType<typeof vi.fn>;
    getSelection: ReturnType<typeof vi.fn>;
  }> = [];
  let contributor: OutputContributor | null = null;
  return {
    terminals,
    setContributor: (next: OutputContributor) => {
      contributor = next;
    },
    getContributor: () => contributor
  };
});

vi.mock("../core.queryengine/output/OutputRegistry", () => ({
  getOutputRegistry: () => ({
    register: (contributor: OutputContributor) => {
      mocks.setContributor(contributor);
    }
  })
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    public buffer = { active: { baseY: 0 } };
    private readonly selectAllSpy = vi.fn();
    private readonly getSelectionSpy = vi.fn(() => "");

    constructor() {
      mocks.terminals.push({
        selectAll: this.selectAllSpy,
        getSelection: this.getSelectionSpy
      });
    }

    loadAddon() {}
    open() {}
    focus() {}
    reset() {}
    write(_chunk: string, cb?: () => void) {
      cb?.();
    }
    scrollToLine() {}
    onScroll() {
      return { dispose() {} };
    }
    dispose() {}
    selectAll() {
      this.selectAllSpy();
    }
    getSelection() {
      return this.getSelectionSpy();
    }
  }
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  }
}));

vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext() {}
    findPrevious() {}
  }
}));

vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {}
}));

import { coreQueryEngineOutputTextPlugin } from "./plugin";

void React;
(globalThis as unknown as { React: typeof React }).React = React;

function makeContext(overrides: Partial<OutputContext> = {}): OutputContext {
  return {
    state: "running",
    resultSets: [],
    features: ["rows"],
    metrics: null,
    error: null,
    progress: null,
    fetchedRowCount: 0,
    executionStartedAtMs: Date.now(),
    textOutputFormat: "plain",
    rowsTargetPrimaryId: "core.queryengine.output.text",
    fileId: "file-1",
    ...overrides
  };
}

describe("text output keyboard shortcuts", () => {
  let rootElement: HTMLDivElement;
  let root: Root;
  let resizeObserverStub: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  const clipboardWriteText = vi.fn(async () => undefined);

  beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.terminals.length = 0;
    resizeObserverStub = { observe: vi.fn(), disconnect: vi.fn() };
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe = resizeObserverStub.observe;
      disconnect = resizeObserverStub.disconnect;
    };
    Object.defineProperty(globalThis.navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true
    });

    coreQueryEngineOutputTextPlugin.activate(
      {} as unknown as Parameters<typeof coreQueryEngineOutputTextPlugin.activate>[0]
    );

    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);

    const contributor = mocks.getContributor();
    expect(contributor).toBeTruthy();

    await act(async () => {
      root.render(<>{contributor!.render(makeContext())}</>);
      await Promise.resolve();
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    rootElement.remove();
    clipboardWriteText.mockReset();
  });

  it("handles Ctrl/Cmd+A by selecting all terminal text", () => {
    const terminal = mocks.terminals[0];
    expect(terminal).toBeTruthy();

    const rootNode = rootElement.querySelector(".query-output-text-root") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "a",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });

    rootNode.dispatchEvent(event);

    expect(terminal!.selectAll).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("handles Ctrl/Cmd+C by copying selected terminal text", async () => {
    const terminal = mocks.terminals[0];
    expect(terminal).toBeTruthy();
    terminal!.getSelection.mockReturnValue("copied text");

    const rootNode = rootElement.querySelector(".query-output-text-root") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "c",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });

    rootNode.dispatchEvent(event);
    await Promise.resolve();

    expect(clipboardWriteText).toHaveBeenCalledWith("copied text");
    expect(event.defaultPrevented).toBe(true);
  });

  it("does not copy when terminal selection is empty", async () => {
    const terminal = mocks.terminals[0];
    expect(terminal).toBeTruthy();
    terminal!.getSelection.mockReturnValue("");

    const rootNode = rootElement.querySelector(".query-output-text-root") as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "c",
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    });

    rootNode.dispatchEvent(event);
    await Promise.resolve();

    expect(clipboardWriteText).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
