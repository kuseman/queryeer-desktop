import { describe, expect, it } from "vitest";
import {
  buildClipboardGridFromRows,
  computeNextSelectionFromClick,
  buildSelectionSnapshot,
  createCopyAsCsvTableContextMenuProvider,
  getCellValueForCopy,
  resolveCellDisplayValue,
  isPrimaryMouseButton,
  toGridColumns,
  toCsvScalar,
} from "./plugin";

describe("table output value formatting", () => {
  it("formats decimal as visible string", () => {
    expect(resolveCellDisplayValue("decimal", 10.1)).toBe("10.1");
    expect(resolveCellDisplayValue("decimal", "10.100000")).toBe("10.100000");
  });

  it("formats datetime values as strings", () => {
    expect(resolveCellDisplayValue("datetime", "2026-04-29T14:43:00.260")).toBe("2026-04-29T14:43:00.260");
    expect(resolveCellDisplayValue("datetimeoffset", "2026-04-29T12:43:00.260Z[UTC]")).toBe("2026-04-29T12:43:00.260Z[UTC]");
  });

  it("formats large values using previews", () => {
    expect(resolveCellDisplayValue("object", {
      kind: "largeValue",
      logicalType: "json",
      byteLength: 100_000,
      preview: "{\"a\":1}",
      ref: "ref-1",
    })).toBe("{\"a\":1}");
  });
});

describe("table output image columns", () => {
  it("recognizes a readable image alias and strips its display suffix", () => {
    expect(toGridColumns([
      { name: "Photo [image]", type: "string" },
      { name: "Website", type: "string" },
      { name: "ICON [IMAGE] ", type: "string" },
    ])).toEqual([
      { key: "Photo", title: "Photo", type: "string", image: true },
      { key: "Website", title: "Website", type: "string", image: false },
      { key: "ICON", title: "ICON", type: "string", image: true },
    ]);
  });
});

describe("table output copy value extraction", () => {
  it("reads value from indexed __values row storage", () => {
    expect(getCellValueForCopy({ __values: ["a", "b", "10.100000"] }, 2)).toBe("10.100000");
  });

  it("reads large values as previews for copy", () => {
    expect(getCellValueForCopy({ __values: [{ kind: "largeValue", logicalType: "json", byteLength: 10, preview: "preview", ref: "r" }] }, 0)).toBe("preview");
  });

  it("returns null for missing row data", () => {
    expect(getCellValueForCopy(undefined, 0)).toBeNull();
  });

  it("builds clipboard grid from indexed row values", () => {
    const grid = buildClipboardGridFromRows(
      [
        { __values: ["2026-04-29T14:43:00.260", "2026-04-29T12:43:00.260Z[UTC]", "10.100000"] }
      ],
      { rowStart: 0, rowEnd: 0, colIndexStart: 0, colIndexEnd: 2 },
      () => true
    );
    expect(grid[0][2].value).toBe("10.100000");
  });
});

describe("table output selection snapshot", () => {
  it("detects single-column selection", () => {
    const snapshot = buildSelectionSnapshot(
      {
        rect: { rowStart: 0, rowEnd: 2, colIndexStart: 1, colIndexEnd: 1 },
        cells: [],
      },
      [
        { __values: ["id-1", "a"] },
        { __values: ["id-2", "b"] },
        { __values: ["id-3", "c"] },
      ],
      2
    );
    expect(snapshot.hasSelection).toBe(true);
    expect(snapshot.isSingleColumnSelection).toBe(true);
    expect(snapshot.selectedColumnIndexes).toEqual([1]);
    expect(snapshot.selectedCells.map((cell) => cell.value)).toEqual(["a", "b", "c"]);
  });
});

describe("copy as csv table context action", () => {
  it("escapes CSV scalar values", () => {
    expect(toCsvScalar("a,b")).toBe('"a,b"');
    expect(toCsvScalar('a"b')).toBe('"a""b"');
    expect(toCsvScalar("plain")).toBe("plain");
  });

  it("contributes copy as csv with item-level rule", async () => {
    const provider = createCopyAsCsvTableContextMenuProvider();
    const items = await provider.getItems({
      resultSetIndex: 0,
      columns: [{ name: "c1", type: "string" }],
      selection: {
        hasSelection: true,
        selectedCells: [{ rowIndex: 0, columnIndex: 0, value: "x" }],
        selectedRowIndexes: [0],
        selectedColumnIndexes: [0],
        isSingleColumnSelection: true,
        isSingleRowSelection: true,
      },
    });
    expect(provider.when).toBe("tableSelection.hasSelection == true");
    expect(items[0]?.when).toBeUndefined();
  });
});

describe("table output mouse button guard", () => {
  it("accepts primary mouse button", () => {
    expect(isPrimaryMouseButton({ button: 0 } as MouseEvent)).toBe(true);
  });

  it("rejects secondary mouse button", () => {
    expect(isPrimaryMouseButton({ button: 2 } as MouseEvent)).toBe(false);
  });

  it("keeps existing multi-cell selection on right-click", () => {
    const existing = {
      rect: { rowStart: 0, rowEnd: 2, colIndexStart: 1, colIndexEnd: 1 },
      cells: [{ row: 4, colIndex: 0 }],
    };
    const anchor = { row: 2, colIndex: 1 };
    const next = computeNextSelectionFromClick({
      mouseEvent: { button: 2 } as MouseEvent,
      rowIndex: 8,
      colIndex: 3,
      totalCols: 5,
      existing,
      anchor,
    });
    expect(next.shouldApply).toBe(false);
    expect(next.selection).toEqual(existing);
    expect(next.anchor).toEqual(anchor);
  });
});
