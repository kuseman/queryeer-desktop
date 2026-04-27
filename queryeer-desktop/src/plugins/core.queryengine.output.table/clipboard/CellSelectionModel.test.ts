import { describe, expect, it } from "vitest";
import { computeSelection, extendSelection, isCellSelected, isRowSelected, getBoundingBox } from "./CellSelectionModel";
import type { SelectionModel } from "./CellSelectionModel";

const TOTAL = 5; // schema has 5 columns

// ---------------------------------------------------------------------------
// computeSelection
// ---------------------------------------------------------------------------

describe("computeSelection — plain click (anchor === active)", () => {
  it("single data cell produces 1×1 selection", () => {
    expect(computeSelection({ row: 2, colIndex: 3 }, { row: 2, colIndex: 3 }, TOTAL)).toEqual({
      rowStart: 2, rowEnd: 2, colIndexStart: 3, colIndexEnd: 3,
    });
  });

  it("row-number click spans all columns", () => {
    expect(computeSelection({ row: 1, colIndex: -1 }, { row: 1, colIndex: -1 }, TOTAL)).toEqual({
      rowStart: 1, rowEnd: 1, colIndexStart: 0, colIndexEnd: TOTAL - 1,
    });
  });
});

describe("computeSelection — shift extension (anchor ≠ active)", () => {
  it("forward row + forward col", () => {
    expect(computeSelection({ row: 1, colIndex: 1 }, { row: 4, colIndex: 3 }, TOTAL)).toEqual({
      rowStart: 1, rowEnd: 4, colIndexStart: 1, colIndexEnd: 3,
    });
  });

  it("backward row + backward col (anchor > active)", () => {
    expect(computeSelection({ row: 4, colIndex: 3 }, { row: 1, colIndex: 1 }, TOTAL)).toEqual({
      rowStart: 1, rowEnd: 4, colIndexStart: 1, colIndexEnd: 3,
    });
  });

  it("anchor is data cell, active is row-number → spans all columns", () => {
    expect(computeSelection({ row: 2, colIndex: 2 }, { row: 5, colIndex: -1 }, TOTAL)).toEqual({
      rowStart: 2, rowEnd: 5, colIndexStart: 0, colIndexEnd: TOTAL - 1,
    });
  });

  it("anchor is row-number, active is data cell → spans all columns", () => {
    expect(computeSelection({ row: 0, colIndex: -1 }, { row: 3, colIndex: 2 }, TOTAL)).toEqual({
      rowStart: 0, rowEnd: 3, colIndexStart: 0, colIndexEnd: TOTAL - 1,
    });
  });

  it("both row-number → spans all columns", () => {
    expect(computeSelection({ row: 0, colIndex: -1 }, { row: 9, colIndex: -1 }, TOTAL)).toEqual({
      rowStart: 0, rowEnd: 9, colIndexStart: 0, colIndexEnd: TOTAL - 1,
    });
  });

  it("same row, different cols → single-row rectangle", () => {
    expect(computeSelection({ row: 3, colIndex: 0 }, { row: 3, colIndex: 4 }, TOTAL)).toEqual({
      rowStart: 3, rowEnd: 3, colIndexStart: 0, colIndexEnd: 4,
    });
  });
});

// ---------------------------------------------------------------------------
// extendSelection
// ---------------------------------------------------------------------------

const base = { rowStart: 2, rowEnd: 4, colIndexStart: 1, colIndexEnd: 3 };

describe("extendSelection — Ctrl+Shift+click expands bounding box", () => {
  it("cell already inside selection is a no-op", () => {
    expect(extendSelection(base, { row: 3, colIndex: 2 }, TOTAL)).toEqual(base);
  });

  it("cell above selection expands rowStart", () => {
    expect(extendSelection(base, { row: 0, colIndex: 2 }, TOTAL)).toEqual({
      ...base, rowStart: 0,
    });
  });

  it("cell below selection expands rowEnd", () => {
    expect(extendSelection(base, { row: 8, colIndex: 2 }, TOTAL)).toEqual({
      ...base, rowEnd: 8,
    });
  });

  it("cell left of selection expands colIndexStart", () => {
    expect(extendSelection(base, { row: 3, colIndex: 0 }, TOTAL)).toEqual({
      ...base, colIndexStart: 0,
    });
  });

  it("cell right of selection expands colIndexEnd", () => {
    expect(extendSelection(base, { row: 3, colIndex: 4 }, TOTAL)).toEqual({
      ...base, colIndexEnd: 4,
    });
  });

  it("row-number click expands to all columns", () => {
    expect(extendSelection(base, { row: 1, colIndex: -1 }, TOTAL)).toEqual({
      rowStart: 1, rowEnd: 4, colIndexStart: 0, colIndexEnd: TOTAL - 1,
    });
  });

  it("row-number click on already-full-width selection only changes rows", () => {
    const fullWidth = { rowStart: 2, rowEnd: 4, colIndexStart: 0, colIndexEnd: TOTAL - 1 };
    expect(extendSelection(fullWidth, { row: 6, colIndex: -1 }, TOTAL)).toEqual({
      rowStart: 2, rowEnd: 6, colIndexStart: 0, colIndexEnd: TOTAL - 1,
    });
  });
});

// ---------------------------------------------------------------------------
// isCellSelected
// ---------------------------------------------------------------------------

const rectModel: SelectionModel = {
  rect: { rowStart: 2, rowEnd: 4, colIndexStart: 1, colIndexEnd: 3 },
  cells: [],
};
const cellsModel: SelectionModel = {
  rect: null,
  cells: [{ row: 1, colIndex: 2 }, { row: 5, colIndex: -1 }],
};
const mixedModel: SelectionModel = {
  rect: { rowStart: 2, rowEnd: 4, colIndexStart: 1, colIndexEnd: 3 },
  cells: [{ row: 0, colIndex: 0 }],
};

describe("isCellSelected — rect only", () => {
  it("cell inside rect is selected", () => {
    expect(isCellSelected(rectModel, 3, 2)).toBe(true);
  });
  it("cell on rect boundary is selected", () => {
    expect(isCellSelected(rectModel, 2, 1)).toBe(true);
    expect(isCellSelected(rectModel, 4, 3)).toBe(true);
  });
  it("cell outside rect is not selected", () => {
    expect(isCellSelected(rectModel, 0, 0)).toBe(false);
    expect(isCellSelected(rectModel, 3, 4)).toBe(false);
  });
});

describe("isCellSelected — individual cells", () => {
  it("exact cell match", () => {
    expect(isCellSelected(cellsModel, 1, 2)).toBe(true);
  });
  it("row-level cell (colIndex -1) selects any column in that row", () => {
    expect(isCellSelected(cellsModel, 5, 0)).toBe(true);
    expect(isCellSelected(cellsModel, 5, 4)).toBe(true);
  });
  it("unrelated cell is not selected", () => {
    expect(isCellSelected(cellsModel, 0, 0)).toBe(false);
  });
});

describe("isCellSelected — mixed rect + cells", () => {
  it("cell in rect is selected", () => {
    expect(isCellSelected(mixedModel, 3, 2)).toBe(true);
  });
  it("individual cell outside rect is selected", () => {
    expect(isCellSelected(mixedModel, 0, 0)).toBe(true);
  });
  it("cell neither in rect nor in cells is not selected", () => {
    expect(isCellSelected(mixedModel, 0, 4)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRowSelected
// ---------------------------------------------------------------------------

describe("isRowSelected", () => {
  it("row inside rect is selected", () => {
    expect(isRowSelected(rectModel, 3)).toBe(true);
  });
  it("row outside rect is not selected (no cells)", () => {
    expect(isRowSelected(rectModel, 0)).toBe(false);
  });
  it("row with individual cell is selected", () => {
    expect(isRowSelected(cellsModel, 1)).toBe(true);
  });
  it("row-level selection (colIndex -1) marks the row", () => {
    expect(isRowSelected(cellsModel, 5)).toBe(true);
  });
  it("mixed: row in rect", () => {
    expect(isRowSelected(mixedModel, 4)).toBe(true);
  });
  it("mixed: row only in individual cells", () => {
    expect(isRowSelected(mixedModel, 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getBoundingBox
// ---------------------------------------------------------------------------

describe("getBoundingBox", () => {
  it("rect only", () => {
    expect(getBoundingBox(rectModel, TOTAL)).toEqual(rectModel.rect);
  });

  it("individual cells only — data cells", () => {
    const model: SelectionModel = {
      rect: null,
      cells: [{ row: 1, colIndex: 2 }, { row: 4, colIndex: 0 }],
    };
    expect(getBoundingBox(model, TOTAL)).toEqual({ rowStart: 1, rowEnd: 4, colIndexStart: 0, colIndexEnd: 2 });
  });

  it("row-level cell (colIndex -1) expands columns to full width", () => {
    const model: SelectionModel = { rect: null, cells: [{ row: 3, colIndex: -1 }] };
    expect(getBoundingBox(model, TOTAL)).toEqual({ rowStart: 3, rowEnd: 3, colIndexStart: 0, colIndexEnd: TOTAL - 1 });
  });

  it("mixed rect + individual cells", () => {
    expect(getBoundingBox(mixedModel, TOTAL)).toEqual({
      rowStart: 0, rowEnd: 4, colIndexStart: 0, colIndexEnd: 3,
    });
  });

  it("empty model returns null", () => {
    expect(getBoundingBox({ rect: null, cells: [] }, TOTAL)).toBeNull();
  });
});
