export type CellSelection = {
  rowStart: number;
  rowEnd: number;
  colIndexStart: number;
  colIndexEnd: number;
  /** When columns are reordered, the exact data-column indices in this selection (supercedes range check). */
  selectedDataCols?: number[];
};

export type SelectionAnchor = {
  row: number;
  /** Column index in schema.columns, or -1 when the row-number column was clicked (means all columns). */
  colIndex: number;
};

/** A single cell added to the selection via Ctrl+click. colIndex === -1 means the whole row. */
export type SelectedCell = { row: number; colIndex: number };

/**
 * The full selection state:
 * - rect:  rectangle from a plain click (1×1) or Shift/Ctrl+Shift extension.
 * - cells: individual cells added via plain Ctrl+click (no bounding box).
 */
export type SelectionModel = {
  rect: CellSelection | null;
  cells: SelectedCell[];
};

// ---------------------------------------------------------------------------
// Pure rect helpers
// ---------------------------------------------------------------------------

/**
 * Compute the rectangular selection from an anchor and an active cell.
 * If either end is the row-number column (colIndex === -1), the selection
 * spans all data columns.
 */
export function computeSelection(
  anchor: SelectionAnchor,
  active: { row: number; colIndex: number },
  totalCols: number
): CellSelection {
  const rowStart = Math.min(anchor.row, active.row);
  const rowEnd = Math.max(anchor.row, active.row);
  if (anchor.colIndex === -1 || active.colIndex === -1) {
    return { rowStart, rowEnd, colIndexStart: 0, colIndexEnd: totalCols - 1 };
  }
  return {
    rowStart,
    rowEnd,
    colIndexStart: Math.min(anchor.colIndex, active.colIndex),
    colIndexEnd: Math.max(anchor.colIndex, active.colIndex),
  };
}

/**
 * Expand an existing rectangle to include a new cell (Ctrl+Shift+click).
 * The anchor stays unchanged; only the bounding box grows.
 */
export function extendSelection(
  existing: CellSelection,
  cell: { row: number; colIndex: number },
  totalCols: number
): CellSelection {
  return {
    rowStart: Math.min(existing.rowStart, cell.row),
    rowEnd: Math.max(existing.rowEnd, cell.row),
    colIndexStart: cell.colIndex === -1 ? 0 : Math.min(existing.colIndexStart, cell.colIndex),
    colIndexEnd: cell.colIndex === -1 ? totalCols - 1 : Math.max(existing.colIndexEnd, cell.colIndex),
  };
}

// ---------------------------------------------------------------------------
// SelectionModel queries
// ---------------------------------------------------------------------------

export function isCellSelected(model: SelectionModel, row: number, colIndex: number): boolean {
  if (model.rect != null && row >= model.rect.rowStart && row <= model.rect.rowEnd) {
    const inCol = model.rect.selectedDataCols
      ? model.rect.selectedDataCols.includes(colIndex)
      : colIndex >= model.rect.colIndexStart && colIndex <= model.rect.colIndexEnd;
    if (inCol) return true;
  }
  // colIndex === -1 on a stored cell means the entire row was selected
  return model.cells.some((c) => c.row === row && (c.colIndex === colIndex || c.colIndex === -1));
}

export function isRowSelected(model: SelectionModel, row: number): boolean {
  if (model.rect != null && row >= model.rect.rowStart && row <= model.rect.rowEnd) return true;
  return model.cells.some((c) => c.row === row);
}

/** Bounding box of the entire selection (rect + individual cells) for clipboard use. */
export function getBoundingBox(model: SelectionModel, totalCols: number): CellSelection | null {
  const rows: number[] = [];
  const cols: number[] = [];

  if (model.rect != null) {
    rows.push(model.rect.rowStart, model.rect.rowEnd);
    cols.push(model.rect.colIndexStart, model.rect.colIndexEnd);
  }

  for (const c of model.cells) {
    rows.push(c.row);
    if (c.colIndex === -1) {
      cols.push(0, totalCols - 1);
    } else {
      cols.push(c.colIndex);
    }
  }

  if (rows.length === 0) return null;
  return {
    rowStart: Math.min(...rows),
    rowEnd: Math.max(...rows),
    colIndexStart: Math.min(...cols),
    colIndexEnd: Math.max(...cols),
  };
}
