import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputContext } from "@queryeer/api/queryengine/OutputExtension";

const mocks = vi.hoisted(() => ({
  findNext: vi.fn(() => Promise.resolve({ row: 1, col: 0 })),
  findPrev: vi.fn(() => Promise.resolve({ row: 0, col: 0 })),
  cancelSearch: vi.fn(),
}));

vi.mock("../../renderer/components/GridComponent", async () => {
  const ReactModule = await import("react");
  return {
    GridComponent: ReactModule.forwardRef((_props, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({
        findNext: mocks.findNext,
        findPrev: mocks.findPrev,
        cancelSearch: mocks.cancelSearch,
      }));
      return <div data-testid="grid" />;
    }),
  };
});

import { TableOutputView } from "./plugin";

void React;

const context: OutputContext = {
  state: "completed",
  resultSets: [{
    resultSetIndex: 0,
    schema: { columns: [{ name: "Name", type: "string" }] },
    rows: [["Charlie"], ["Alice"], ["Bob"]],
    rowCount: 3,
    rowLimitExceeded: false,
  }],
  output: [],
  features: ["rows"],
  artifacts: [],
  metrics: null,
  error: null,
  progress: null,
  fetchedRowCount: 3,
  executionStartedAtMs: 1,
  textOutputFormat: "plain",
  rowsTargetPrimaryId: null,
  outputSessionId: "session-1",
};

describe("table output find bar", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.findNext.mockClear();
    mocks.findPrev.mockClear();
    mocks.cancelSearch.mockClear();
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
    await act(async () => {
      root.render(<TableOutputView context={context} onPreviewValue={() => undefined} />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    rootElement.remove();
  });

  async function openFind(): Promise<HTMLInputElement> {
    const container = rootElement.querySelector(".table-output-container") as HTMLElement;
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    return rootElement.querySelector(".table-output-findbar input") as HTMLInputElement;
  }

  it("does not intercept Ctrl+X in the search input", async () => {
    const input = await openFind();
    const event = new KeyboardEvent("keydown", { key: "x", ctrlKey: true, bubbles: true, cancelable: true });

    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("runs find-next from Enter and the Next button", async () => {
    const input = await openFind();
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(input, "Charlie");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await Promise.resolve();
    });
    expect(mocks.findNext).toHaveBeenCalledWith(null, "Charlie");

    mocks.findNext.mockClear();
    const nextButton = Array.from(rootElement.querySelectorAll(".table-output-findbar button"))
      .find(button => button.textContent === "Next") as HTMLButtonElement;
    await act(async () => {
      nextButton.click();
      await Promise.resolve();
    });
    expect(mocks.findNext).toHaveBeenCalledWith({ row: 1, col: 0 }, "Charlie");
  });
});
