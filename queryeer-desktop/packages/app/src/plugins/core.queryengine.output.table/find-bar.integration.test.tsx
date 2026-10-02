import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutputContext } from "@queryeer/api/queryengine/OutputExtension";

type DataEditorProps = {
  onHeaderClicked: (colIndex: number) => void;
  getCellContent: (cell: readonly [number, number]) => { displayData?: string; themeOverride?: Record<string, string> };
};

const glide = vi.hoisted(() => ({
  latestProps: null as DataEditorProps | null,
  latestRef: null as { scrollTo: ReturnType<typeof vi.fn>; updateCells: ReturnType<typeof vi.fn> } | null,
  scrollTo: vi.fn(),
  updateCells: vi.fn(),
}));

vi.mock("@glideapps/glide-data-grid", async () => {
  const ReactModule = await import("react");
  class CompactSelectionMock {
    static empty(): CompactSelectionMock {
      return new CompactSelectionMock();
    }

    add(): CompactSelectionMock {
      return this;
    }

    *[Symbol.iterator](): Iterator<number> {}
  }

  return {
    CompactSelection: CompactSelectionMock,
    GridCellKind: { Text: "text", Uri: "uri", Image: "image" },
    DataEditor: ReactModule.forwardRef((props: DataEditorProps, ref: React.Ref<unknown>) => {
      glide.latestProps = props;
      const refValue = {
        scrollTo: glide.scrollTo,
        updateCells: glide.updateCells,
        remeasureColumns: vi.fn(),
      };
      glide.latestRef = refValue;
      if (ref && typeof ref === "object" && "current" in ref) {
        (ref as React.MutableRefObject<typeof refValue>).current = refValue;
      }
      return null;
    }),
  };
});

import { TableOutputView } from "./plugin";
import { getTableResultStore } from "./table-result-store";

void React;

const storeKey = { outputSessionId: "find-session", fileId: "find-file", resultSetIndex: 0 };
const context: OutputContext = {
  state: "completed",
  resultSets: [{
    resultSetIndex: 0,
    schema: { columns: [{ name: "Name", type: "string" }] },
    rows: [],
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
  outputSessionId: storeKey.outputSessionId,
  fileId: storeKey.fileId,
};

describe("table output sorted find integration", () => {
  let rootElement: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    getTableResultStore().clear(storeKey);
    getTableResultStore().appendRows(storeKey, [["Charlie"], ["Alice"], ["Bob"]]);
    glide.latestProps = null;
    glide.latestRef = null;
    glide.scrollTo.mockClear();
    glide.updateCells.mockClear();
    rootElement = document.createElement("div");
    document.body.appendChild(rootElement);
    root = createRoot(rootElement);
    await act(async () => {
      root.render(<TableOutputView context={context} onPreviewValue={() => undefined} />);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    getTableResultStore().clear(storeKey);
    rootElement.remove();
  });

  it("sorts, finds pasted text, and scrolls the real grid to the match", async () => {
    await act(async () => {
      glide.latestProps?.onHeaderClicked(0);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(glide.latestProps?.getCellContent([0, 2]).displayData).toBe("Charlie");

    const container = rootElement.querySelector(".table-output-container") as HTMLElement;
    await act(async () => {
      container.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const input = rootElement.querySelector(".table-output-findbar input") as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(input, "Charlie");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(input.value).toBe("Charlie");
    const nextButton = Array.from(rootElement.querySelectorAll(".table-output-findbar button"))
      .find(button => button.textContent === "Next") as HTMLButtonElement;
    expect(nextButton.disabled).toBe(false);

    await act(async () => {
      nextButton.click();
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    expect(glide.latestProps?.getCellContent([0, 2]).themeOverride).toEqual({ bgCell: "rgba(255, 180, 0, 0.45)" });
    expect(glide.scrollTo).toHaveBeenCalledWith(0, 2);
    expect(glide.updateCells).toHaveBeenCalledWith([{ cell: [0, 2] }]);
  });
});
