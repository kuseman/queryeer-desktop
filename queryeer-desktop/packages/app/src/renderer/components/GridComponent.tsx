import "./GridComponent.css";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  CompactSelection,
  DataEditor,
  GridCellKind,
  type CellClickedEventArgs,
  type DataEditorRef,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
  type Theme,
} from "@glideapps/glide-data-grid";
import { computeSelection, extendSelection, getBoundingBox, isCellSelected } from "../../plugins/core.queryengine.output.table/clipboard/CellSelectionModel";
import { isPrimaryModifier } from "../../shared/platform-utils";
import type { SelectionAnchor, SelectionModel } from "../../plugins/core.queryengine.output.table/clipboard/CellSelectionModel";

const DEFAULT_ROW_NUMBER_COL_WIDTH_PX = 78;
const DEFAULT_COLUMN_WIDTH_PX = 160;
const MIN_COLUMN_WIDTH_PX = 60;
const MAX_COLUMN_AUTO_WIDTH_PX = 500;
const ROW_HEIGHT_PX = 24;
const HEADER_HEIGHT_PX = 26;
const ROW_REFRESH_THROTTLE_MS = 100;
const AUTO_SIZE_DEBOUNCE_MS = 500;
const CELL_PADDING_PX = 16;

let textMeasureCanvas: HTMLCanvasElement | null = null;

function measureTextWidth(text: string, font: string): number {
  if (!textMeasureCanvas) {
    textMeasureCanvas = document.createElement("canvas");
  }
  const ctx = textMeasureCanvas.getContext("2d");
  if (!ctx) return text.length * 7;
  ctx.font = font;
  return ctx.measureText(text).width;
}

function measureCellWidth(text: string | null | undefined, font: string): number {
  const display = text != null ? String(text) : "";
  return measureTextWidth(display, font) + CELL_PADDING_PX;
}

export type GridComponentColumn = {
  key: string;
  title: string;
  type: string;
};

export type GridComponentState = {
  columnWidths: Record<string, number>;
  scrollOffset?: { x: number; y: number };
  columnOrder?: string[];
};

export type GridComponentRow = {
  __values: unknown[];
};

export type GridComponentSelectionSnapshot = {
  model: SelectionModel;
  rowsByIndex: Array<GridComponentRow | undefined>;
  colOrder?: string[];
};

export type GridComponentContextMenuEvent = {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
};

export type GridSearchHandle = {
  findNext: (from: { row: number; col: number } | null) => Promise<{ row: number; col: number } | null>;
  findPrev: (from: { row: number; col: number } | null) => Promise<{ row: number; col: number } | null>;
  cancelSearch: () => void;
};

export type GridComponentProps = {
  columns: GridComponentColumn[];
  rowNumberWidth?: number;
  autoSizeColumnThreshold?: number;
  getRowCount: () => number;
  getRowsRange: (start: number, end: number) => unknown[][];
  getRow: (index: number) => unknown[] | undefined;
  subscribeRowsChanged: (listener: () => void) => () => void;
  getInitialSelection?: () => { selection: SelectionModel | null; anchor: SelectionAnchor | null };
  onSelectionChange?: (selection: SelectionModel | null, anchor: SelectionAnchor | null) => void;
  getInitialGridState?: () => GridComponentState | undefined;
  onGridStateChange?: (state: GridComponentState) => void;
  resolveCellDisplayValue: (type: string, value: unknown) => string;
  resolveCellLink: (options: { value: unknown; columnType: string }) => unknown;
  onCellPrimaryAction: (options: { columnIndex: number; value: unknown; columnType: string }) => boolean;
  onCopySelection: (snapshot: GridComponentSelectionSnapshot) => void;
  onContextMenuSelection: (event: GridComponentContextMenuEvent, snapshot: GridComponentSelectionSnapshot) => void;
  isDarkTheme: boolean;
  isStreaming?: boolean;
  searchText?: string;
  searchCaseSensitive?: boolean;
  searchRegex?: boolean;
  searchWholeWord?: boolean;
  searchMarkAll?: boolean;
  searchActiveMatch?: { row: number; col: number } | null;
  onSearchMatchesUpdate?: (matches: Array<{ row: number; col: number }>) => void;
};

type VisibleRowsCache = {
  start: number;
  end: number;
  rows: GridComponentRow[];
};

function mapRow(row: unknown[]): GridComponentRow {
  return { __values: row };
}

function mapStoredRow(row: unknown[] | undefined): GridComponentRow | undefined {
  return row ? mapRow(row) : undefined;
}

function getCellValue(rowData: GridComponentRow | undefined, columnIndex: number): unknown {
  if (!rowData || !Array.isArray(rowData.__values)) {
    return null;
  }
  return rowData.__values[columnIndex] ?? null;
}

function matchesSearch(
  cellValue: string,
  searchText: string,
  caseSensitive?: boolean,
  useRegex?: boolean,
  wholeWord?: boolean
): boolean {
  if (!searchText) return false;
  let text = cellValue;
  let pattern = searchText;
  if (!caseSensitive) {
    text = text.toLowerCase();
    pattern = pattern.toLowerCase();
  }
  if (useRegex) {
    try {
      const flags = caseSensitive ? "g" : "gi";
      const re = wholeWord ? new RegExp(`\\b${pattern}\\b`, flags) : new RegExp(pattern, flags);
      return re.test(text);
    } catch {
      return false;
    }
  }
  if (wholeWord) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, caseSensitive ? "g" : "gi");
    return re.test(text);
  }
  return text.includes(pattern);
}

export function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return String(a).localeCompare(String(b));
}

export function isPrimaryMouseButton(event: Pick<MouseEvent, "button"> | Pick<CellClickedEventArgs, "button"> | null): boolean {
  return event == null || event.button === 0;
}

export function computeNextSelectionFromClick(input: {
  mouseEvent: Pick<MouseEvent, "button" | "shiftKey" | "ctrlKey" | "metaKey"> | Pick<CellClickedEventArgs, "button" | "shiftKey" | "ctrlKey" | "metaKey"> | null;
  rowIndex: number;
  colIndex: number;
  totalCols: number;
  existing: SelectionModel | null;
  anchor: SelectionAnchor | null;
}): { shouldApply: boolean; selection: SelectionModel | null; anchor: SelectionAnchor | null } {
  const { mouseEvent, rowIndex, colIndex, totalCols, existing, anchor } = input;
  if (!isPrimaryMouseButton(mouseEvent)) {
    return { shouldApply: false, selection: existing, anchor };
  }

  const shift = !!mouseEvent?.shiftKey;
  const ctrl = isPrimaryModifier(mouseEvent);
  let nextSelection: SelectionModel | null = existing;
  let nextAnchor: SelectionAnchor | null = anchor;
  if (shift && ctrl) {
    const prevRect = existing?.rect ?? computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, totalCols);
    nextSelection = { rect: extendSelection(prevRect, { row: rowIndex, colIndex }, totalCols), cells: existing?.cells ?? [] };
    nextAnchor = { row: rowIndex, colIndex };
  } else if (shift && anchor !== null) {
    nextSelection = { rect: computeSelection(anchor, { row: rowIndex, colIndex }, totalCols), cells: existing?.cells ?? [] };
  } else if (ctrl) {
    const cells = existing?.cells ?? [];
    const already = cells.some((c) => c.row === rowIndex && c.colIndex === colIndex);
    nextSelection = { rect: existing?.rect ?? null, cells: already ? cells.filter((c) => c.row !== rowIndex || c.colIndex !== colIndex) : [...cells, { row: rowIndex, colIndex }] };
    nextAnchor = { row: rowIndex, colIndex };
  } else {
    nextAnchor = { row: rowIndex, colIndex };
    nextSelection = { rect: computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, totalCols), cells: [] };
  }
  return { shouldApply: true, selection: nextSelection, anchor: nextAnchor };
}

function toGlideSelection(
  model: SelectionModel | null,
  toVisualIndex: (dataCol: number) => number = (i) => i
): GridSelection {
  const rowSelection = (model?.cells ?? []).filter((cell) => cell.colIndex === -1).reduce((selection, cell) => selection.add(cell.row), CompactSelection.empty());
  const individualCells = (model?.cells ?? []).filter((cell) => cell.colIndex >= 0);
  const individualRanges = individualCells.map((cell) => ({ x: toVisualIndex(cell.colIndex), y: cell.row, width: 1, height: 1 }));
  if (!model?.rect) {
    const first = individualCells[0];
    return {
      current: first ? {
        cell: [toVisualIndex(first.colIndex), first.row],
        range: { x: toVisualIndex(first.colIndex), y: first.row, width: 1, height: 1 },
        rangeStack: individualRanges.slice(1),
      } : undefined,
      columns: CompactSelection.empty(),
      rows: rowSelection,
    };
  }
  const selectedDataCols = model.rect.selectedDataCols;
  let visStart: number;
  let x: number;
  let width: number;
  if (selectedDataCols && selectedDataCols.length > 0) {
    const visualCols = selectedDataCols.map(toVisualIndex);
    const visMin = Math.min(...visualCols);
    const visMax = Math.max(...visualCols);
    visStart = visMin;
    x = visMin;
    width = visMax - visMin + 1;
  } else {
    const colStart = model.rect.colIndexStart;
    const colEnd = model.rect.colIndexEnd;
    visStart = toVisualIndex(colStart);
    const visEnd = toVisualIndex(colEnd);
    x = Math.min(visStart, visEnd);
    width = Math.abs(visEnd - visStart) + 1;
  }
  return {
    current: {
      cell: [visStart, model.rect.rowStart],
      range: { x, y: model.rect.rowStart, width, height: model.rect.rowEnd - model.rect.rowStart + 1 },
      rangeStack: individualRanges,
    },
    columns: CompactSelection.empty(),
    rows: rowSelection,
  };
}

function fromGlideSelection(
  selection: GridSelection,
  totalCols: number,
  toDataIndex: (visualCol: number) => number = (i) => i,
  hasReorderedColumns: boolean = false
): { selection: SelectionModel | null; anchor: SelectionAnchor | null } {
  const cells = [...selection.rows].map((row) => ({ row, colIndex: -1 }));
  const current = selection.current;
  if (!current) {
    return cells.length > 0 ? { selection: { rect: null, cells }, anchor: null } : { selection: null, anchor: null };
  }
  for (const range of current.rangeStack) {
    if (range.width === 1 && range.height === 1 && range.x >= 0 && range.x < totalCols) {
      cells.push({ row: range.y, colIndex: toDataIndex(range.x) });
    }
  }
  const rowStart = current.range.y;
  const rowEnd = current.range.y + current.range.height - 1;
  const colVisStart = current.range.x;
  const colVisEnd = current.range.x + current.range.width - 1;
  let colIndexStart: number;
  let colIndexEnd: number;
  let selectedDataCols: number[] | undefined;
  if (hasReorderedColumns) {
    const dataColSet: number[] = [];
    for (let c = colVisStart; c <= colVisEnd; c++) {
      const dataIdx = toDataIndex(c);
      if (dataIdx >= 0 && dataIdx < totalCols) dataColSet.push(dataIdx);
    }
    dataColSet.sort((a, b) => a - b);
    colIndexStart = dataColSet[0] ?? Math.max(0, colVisStart);
    colIndexEnd = dataColSet[dataColSet.length - 1] ?? Math.min(totalCols - 1, colVisEnd);
    if (dataColSet.length < colIndexEnd - colIndexStart + 1) {
      selectedDataCols = dataColSet;
    }
  } else {
    colIndexStart = Math.max(0, colVisStart);
    colIndexEnd = Math.min(totalCols - 1, colVisEnd);
  }
  if (current.range.width === 1 && current.range.height === 1 && cells.length > 0) {
    cells.push({ row: rowStart, colIndex: colIndexStart });
    return {
      selection: { rect: null, cells },
      anchor: { row: current.cell[1], colIndex: colIndexStart },
    };
  }
  return {
    selection: { rect: { rowStart, rowEnd, colIndexStart, colIndexEnd, selectedDataCols }, cells },
    anchor: { row: current.cell[1], colIndex: colIndexStart },
  };
}

function readCssVar(styles: CSSStyleDeclaration | null, name: string, fallback: string): string {
  const value = styles?.getPropertyValue(name).trim();
  return value && value.length > 0 ? value : fallback;
}

function createTheme(isDarkTheme: boolean, element?: HTMLElement | null): Partial<Theme> {
  const styles = element ? window.getComputedStyle(element) : null;
  const bg0 = readCssVar(styles, "--bg-0", isDarkTheme ? "#1e1e1e" : "#ffffff");
  const bg1 = readCssVar(styles, "--bg-1", isDarkTheme ? "#252526" : "#f3f3f3");
  const bg2 = readCssVar(styles, "--bg-2", isDarkTheme ? "#2d2d2d" : "#eeeeee");
  const bg3 = readCssVar(styles, "--bg-3", isDarkTheme ? "#333333" : "#e6e6e6");
  const text0 = readCssVar(styles, "--text-0", isDarkTheme ? "#cccccc" : "#1f1f1f");
  const text1 = readCssVar(styles, "--text-1", isDarkTheme ? "#858585" : "#555555");
  const text2 = readCssVar(styles, "--text-2", isDarkTheme ? "#6b6b6b" : "#777777");
  const accent = readCssVar(styles, "--accent", "#0e639c");
  const border = readCssVar(styles, "--border", isDarkTheme ? "#454545" : "#d0d0d0");
  const fontFamily = readCssVar(styles, "--font-sans", "Segoe UI, Arial, sans-serif");

  return {
    accentColor: accent,
    accentFg: "#ffffff",
    accentLight: "rgba(100, 160, 255, 0.22)",
    textDark: text0,
    textMedium: text1,
    textLight: text2,
    textHeader: text1,
    bgCell: bg0,
    bgCellMedium: bg1,
    bgHeader: bg2,
    bgHeaderHovered: bg3,
    bgHeaderHasFocus: bg3,
    borderColor: border,
    horizontalBorderColor: border,
    linkColor: accent,
    cellHorizontalPadding: 8,
    cellVerticalPadding: 3,
    headerFontStyle: "12px",
    baseFontStyle: "12px",
    fontFamily,
    editorFontSize: "12px",
    lineHeight: 1.25,
    bgBubble: bg2,
    bgBubbleSelected: bg3,
  };
}

function resolveScrollOffsetFromVisibleRegion(range: { x: number; y: number }, columns: readonly GridColumn[]): { x: number; y: number } {
  let x = 0;
  for (let i = 0; i < range.x; i++) {
    const column = columns[i];
    x += column && "width" in column ? column.width : DEFAULT_COLUMN_WIDTH_PX;
  }
  return { x, y: range.y * ROW_HEIGHT_PX };
}

export const GridComponent = forwardRef<GridSearchHandle, GridComponentProps>(function GridComponent({
  columns,
  rowNumberWidth = DEFAULT_ROW_NUMBER_COL_WIDTH_PX,
  autoSizeColumnThreshold = 30,
  getRowCount,
  getRowsRange,
  getRow,
  subscribeRowsChanged,
  getInitialSelection,
  onSelectionChange,
  getInitialGridState,
  onGridStateChange,
  resolveCellDisplayValue,
  resolveCellLink,
  onCellPrimaryAction,
  onCopySelection,
  onContextMenuSelection,
  isDarkTheme,
  isStreaming = false,
  searchText,
  searchCaseSensitive,
  searchRegex,
  searchWholeWord,
  searchMarkAll = false,
  searchActiveMatch,
  onSearchMatchesUpdate,
}: GridComponentProps, ref): JSX.Element {
  const gridRef = useRef<DataEditorRef | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [initialGridState] = useState(() => getInitialGridState?.());
  const initialSelection = useMemo(() => getInitialSelection?.() ?? { selection: null, anchor: null }, [getInitialSelection]);
  const [selection, setSelection] = useState<SelectionModel | null>(initialSelection.selection);
  const [glideSelection, setGlideSelection] = useState<GridSelection>(() => toGlideSelection(initialSelection.selection));
  const selectionRef = useRef<SelectionModel | null>(initialSelection.selection);
  const previousSelectionRef = useRef<SelectionModel | null>(initialSelection.selection);
  const anchorRef = useRef<SelectionAnchor | null>(initialSelection.anchor);
  const [rowCount, setRowCount] = useState(() => getRowCount());
  const rowCountRef = useRef(rowCount);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => initialGridState?.columnWidths ?? {});
  const gridStateRef = useRef<GridComponentState>(initialGridState ?? { columnWidths: {} });
  const visibleRegionRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const visibleRowsRef = useRef<VisibleRowsCache>({ start: 0, end: 0, rows: [] });
  const pendingRowRefreshRef = useRef<number | null>(null);
  const lastAutoSizeRowCountRef = useRef<number>(-1);
  const pendingAutoSizeTimerRef = useRef<number | null>(null);
  const lastClickedCellRef = useRef<[number, number] | null>(null);
  const clickCountRef = useRef<number>(0);
  const clickTimerRef = useRef<number | null>(null);
  const isKeyboardActivationRef = useRef<boolean>(false);
  const [columnOrder, setColumnOrder] = useState<string[] | undefined>(() => initialGridState?.columnOrder);
  const [sortColumnKey, setSortColumnKey] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(null);
  const sortedRowsRef = useRef<unknown[][] | null>(null);
  const [isSorting, setIsSorting] = useState(false);
  const isSortingGuardRef = useRef(false);
  const sortTimeoutRef = useRef<number | null>(null);
  selectionRef.current = selection;
  rowCountRef.current = rowCount;

  const onSearchMatchesUpdateRef = useRef(onSearchMatchesUpdate);
  onSearchMatchesUpdateRef.current = onSearchMatchesUpdate;
  const resolveCellDisplayValueRef = useRef(resolveCellDisplayValue);
  resolveCellDisplayValueRef.current = resolveCellDisplayValue;
  const getRowsRangeRef = useRef(getRowsRange);
  getRowsRangeRef.current = getRowsRange;
  const activeCancelRef = useRef<(() => void) | null>(null);
  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;
  const searchCaseSensitiveRef = useRef(searchCaseSensitive);
  searchCaseSensitiveRef.current = searchCaseSensitive;
  const searchRegexRef = useRef(searchRegex);
  searchRegexRef.current = searchRegex;
  const searchWholeWordRef = useRef(searchWholeWord);
  searchWholeWordRef.current = searchWholeWord;
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const getRowDataRef = useRef<(rowIndex: number) => GridComponentRow | undefined>(undefined as never);
  const getRowCountRef = useRef(getRowCount);
  getRowCountRef.current = getRowCount;

  const [internalSearchMatches, setInternalSearchMatches] = useState<Array<{ row: number; col: number }>>([]);
  const internalSearchMatchSet = useMemo(() => {
    return new Set(internalSearchMatches.map(m => `${m.row}:${m.col}`));
  }, [internalSearchMatches]);

  const FIND_BATCH = 500;

  const findNextMatch = useCallback((from: { row: number; col: number } | null): Promise<{ row: number; col: number } | null> => {
    activeCancelRef.current?.();
    return new Promise<{ row: number; col: number } | null>((resolve) => {
      const token = { cancelled: false };
      activeCancelRef.current = () => { token.cancelled = true; };
      const text = searchTextRef.current;
      if (!text) { resolve(null); return; }
      const count = getRowCountRef.current();
      const cols = columnsRef.current;
      if (count === 0 || cols.length === 0) { resolve(null); return; }
      const numCols = cols.length;
      let startRow: number, startCol: number;
      if (from === null) {
        startRow = 0; startCol = 0;
      } else {
        startCol = from.col + 1; startRow = from.row;
        if (startCol >= numCols) { startCol = 0; startRow++; }
        if (startRow >= count) { resolve(null); return; }
      }
      const scanBatch = (batchStart: number, batchStartCol: number, endRow: number, endCol: number, onDone: () => void) => {
        if (token.cancelled) { onDone(); return; }
        if (batchStart > endRow) { onDone(); return; }
        const batchEnd = Math.min(batchStart + FIND_BATCH, endRow + 1);
        const rawRows = getRowsRangeRef.current(batchStart, batchEnd);
        for (let r = batchStart; r < batchEnd; r++) {
          const rawRow = rawRows[r - batchStart] as unknown[] | undefined;
          if (!rawRow) continue;
          const cStart = r === batchStart ? batchStartCol : 0;
          const cLast = r === endRow ? endCol : numCols - 1;
          for (let c = cStart; c <= cLast; c++) {
            const val = resolveCellDisplayValueRef.current(cols[c].type, (rawRow[c] as unknown) ?? null);
            if (matchesSearch(val, text, searchCaseSensitiveRef.current, searchRegexRef.current, searchWholeWordRef.current)) {
              resolve({ row: r, col: c }); return;
            }
          }
        }
        if (batchEnd > endRow) { onDone(); }
        else { setTimeout(() => scanBatch(batchEnd, 0, endRow, endCol, onDone), 0); }
      };
      // Phase 1: from startRow to end of data
      scanBatch(startRow, startCol, count - 1, numCols - 1, () => {
        if (token.cancelled || from === null) { resolve(null); return; }
        // Phase 2: wrap — from (0,0) to just before 'from'
        let wrapEndRow = from.row, wrapEndCol = from.col - 1;
        if (wrapEndCol < 0) { wrapEndRow = from.row - 1; wrapEndCol = numCols - 1; }
        if (wrapEndRow < 0) { resolve(null); return; }
        scanBatch(0, 0, wrapEndRow, wrapEndCol, () => { if (!token.cancelled) resolve(null); });
      });
    });
  }, []);

  const findPrevMatch = useCallback((from: { row: number; col: number } | null): Promise<{ row: number; col: number } | null> => {
    activeCancelRef.current?.();
    return new Promise<{ row: number; col: number } | null>((resolve) => {
      const token = { cancelled: false };
      activeCancelRef.current = () => { token.cancelled = true; };
      const text = searchTextRef.current;
      if (!text) { resolve(null); return; }
      const count = getRowCountRef.current();
      const cols = columnsRef.current;
      if (count === 0 || cols.length === 0) { resolve(null); return; }
      const numCols = cols.length;
      let startRow: number, startCol: number;
      if (from === null) {
        startRow = count - 1; startCol = numCols - 1;
      } else {
        startCol = from.col - 1; startRow = from.row;
        if (startCol < 0) { startCol = numCols - 1; startRow--; }
        if (startRow < 0) { resolve(null); return; }
      }
      const scanBatchRev = (batchUpper: number, batchUpperCol: number, endRow: number, endCol: number, onDone: () => void) => {
        if (token.cancelled) { onDone(); return; }
        if (batchUpper < endRow) { onDone(); return; }
        const batchLower = Math.max(endRow, batchUpper - FIND_BATCH + 1);
        const rawRows = getRowsRangeRef.current(batchLower, batchUpper + 1);
        for (let r = batchUpper; r >= batchLower; r--) {
          const rawRow = rawRows[r - batchLower] as unknown[] | undefined;
          if (!rawRow) continue;
          const cStart = r === batchUpper ? batchUpperCol : numCols - 1;
          const cLast = r === endRow ? endCol : 0;
          for (let c = cStart; c >= cLast; c--) {
            const val = resolveCellDisplayValueRef.current(cols[c].type, (rawRow[c] as unknown) ?? null);
            if (matchesSearch(val, text, searchCaseSensitiveRef.current, searchRegexRef.current, searchWholeWordRef.current)) {
              resolve({ row: r, col: c }); return;
            }
          }
        }
        if (batchLower <= endRow) { onDone(); }
        else { setTimeout(() => scanBatchRev(batchLower - 1, numCols - 1, endRow, endCol, onDone), 0); }
      };
      // Phase 1: from startRow down to row 0
      scanBatchRev(startRow, startCol, 0, 0, () => {
        if (token.cancelled || from === null) { resolve(null); return; }
        // Phase 2: wrap — from end of data down to just after 'from'
        let wrapStartRow = from.row, wrapStartCol = from.col + 1;
        if (wrapStartCol >= numCols) { wrapStartRow = from.row + 1; wrapStartCol = 0; }
        if (wrapStartRow >= count) { resolve(null); return; }
        scanBatchRev(count - 1, numCols - 1, wrapStartRow, wrapStartCol, () => { if (!token.cancelled) resolve(null); });
      });
    });
  }, []);

  const cancelSearchFn = useCallback(() => {
    activeCancelRef.current?.();
    activeCancelRef.current = null;
  }, []);

  useImperativeHandle(ref, () => ({ findNext: findNextMatch, findPrev: findPrevMatch, cancelSearch: cancelSearchFn }), [findNextMatch, findPrevMatch, cancelSearchFn]);

  const getDataIndex = useCallback((visualColIndex: number): number => {
    if (!columnOrder || visualColIndex < 0 || visualColIndex >= columnOrder.length) return visualColIndex;
    const key = columnOrder[visualColIndex];
    if (!key) return visualColIndex;
    return columns.findIndex(c => c.key === key);
  }, [columnOrder, columns]);

  const getVisualIndex = useCallback((dataColIndex: number): number => {
    if (!columnOrder || dataColIndex < 0 || dataColIndex >= columns.length) return dataColIndex;
    const key = columns[dataColIndex]?.key;
    if (!key) return dataColIndex;
    return columnOrder.indexOf(key);
  }, [columnOrder, columns]);

  useEffect(() => {
    setColumnOrder((current) => {
      if (!current) return current;
      const validKeys = new Set(columns.map((c) => c.key));
      if (current.every((k) => validKeys.has(k))) return current;
      const nextState = { ...gridStateRef.current };
      delete nextState.columnOrder;
      gridStateRef.current = nextState;
      onGridStateChange?.(nextState);
      return undefined;
    });
  }, [columns, onGridStateChange]);

  const glideColumns = useMemo<readonly GridColumn[]>(() => {
    const ordered = columnOrder
      ? columnOrder.map((key) => columns.find((c) => c.key === key)).filter((c): c is GridComponentColumn => c !== undefined)
      : columns;
    return ordered.map((column) => {
      let title = column.title;
      if (sortColumnKey === column.key) {
        title = sortDirection === "asc" ? `\u25B2 ${title}` : `\u25BC ${title}`;
      }
      return {
        id: column.key,
        title,
        width: columnWidths[column.key] ?? DEFAULT_COLUMN_WIDTH_PX,
      };
    });
  }, [columnWidths, columns, columnOrder, sortColumnKey, sortDirection]);

  const [theme, setTheme] = useState<Partial<Theme>>(() => createTheme(isDarkTheme));

  const autoSizeColumns = useCallback(() => {
    if (columns.length === 0) return;
    let sample = visibleRowsRef.current.rows;
    if (sample.length === 0) {
      const count = getRowCount();
      if (count > 0) {
        sample = getRowsRange(0, Math.min(50, count)).map(mapRow);
      }
    }
    const font = theme.fontFamily
      ? `12px ${theme.fontFamily.replace(/['"]/g, "")}`
      : "12px Segoe UI, Arial, sans-serif";
    const next = { ...columnWidths };
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      let maxW = measureCellWidth(col.title, font);
      for (const row of sample) {
        const value = getCellValue(row, i);
        const str = resolveCellDisplayValue(col.type, value);
        const w = measureCellWidth(str, font);
        if (w > maxW) maxW = w;
      }
      next[col.key] = Math.min(Math.max(Math.ceil(maxW), MIN_COLUMN_WIDTH_PX), MAX_COLUMN_AUTO_WIDTH_PX);
    }
    setColumnWidths(next);
    const autoState = { ...gridStateRef.current, columnWidths: next };
    gridStateRef.current = autoState;
    onGridStateChange?.(autoState);
  }, [columns, columnWidths, getRowCount, getRowsRange, resolveCellDisplayValue, getCellValue, onGridStateChange, theme.fontFamily]);

  useEffect(() => {
    setTheme(createTheme(isDarkTheme, containerRef.current));
  }, [isDarkTheme]);

  useEffect(() => {
    if (rowCount === 0) return;
    const threshold = Math.max(1, autoSizeColumnThreshold);
    const currentBucket = Math.floor(rowCount / threshold);
    const lastBucket = Math.floor(lastAutoSizeRowCountRef.current / threshold);
    if (currentBucket > lastBucket) {
      lastAutoSizeRowCountRef.current = rowCount;
      autoSizeColumns();
    }
    if (pendingAutoSizeTimerRef.current !== null) {
      window.clearTimeout(pendingAutoSizeTimerRef.current);
    }
    pendingAutoSizeTimerRef.current = window.setTimeout(() => {
      pendingAutoSizeTimerRef.current = null;
      if (rowCount > lastAutoSizeRowCountRef.current) {
        lastAutoSizeRowCountRef.current = rowCount;
        autoSizeColumns();
      }
    }, AUTO_SIZE_DEBOUNCE_MS);
  }, [rowCount, autoSizeColumns, autoSizeColumnThreshold]);

  const applySelection = useCallback((newSelection: SelectionModel | null, newAnchor: SelectionAnchor | null) => {
    previousSelectionRef.current = selectionRef.current;
    selectionRef.current = newSelection;
    anchorRef.current = newAnchor;
    setSelection(newSelection);
    setGlideSelection(toGlideSelection(newSelection, getVisualIndex));
    onSelectionChange?.(newSelection, newAnchor);
  }, [getVisualIndex, onSelectionChange]);

  const refreshVisibleRows = useCallback((start: number, end: number) => {
    const safeStart = Math.max(0, start);
    const safeEnd = Math.max(safeStart, Math.min(getRowCount(), end));
    const sorted = sortedRowsRef.current;
    visibleRowsRef.current = {
      start: safeStart,
      end: safeEnd,
      rows: sorted
        ? sorted.slice(safeStart, safeEnd).map(mapRow)
        : getRowsRange(safeStart, safeEnd).map(mapRow),
    };
  }, [getRowCount, getRowsRange]);

  const getRowData = useCallback((rowIndex: number): GridComponentRow | undefined => {
    const sorted = sortedRowsRef.current;
    if (sorted) {
      if (rowIndex >= 0 && rowIndex < sorted.length) {
        const cached = visibleRowsRef.current;
        if (rowIndex >= cached.start && rowIndex < cached.end) {
          return cached.rows[rowIndex - cached.start];
        }
        return mapRow(sorted[rowIndex]);
      }
      return undefined;
    }
    const cached = visibleRowsRef.current;
    if (rowIndex >= cached.start && rowIndex < cached.end) {
      return cached.rows[rowIndex - cached.start];
    }
    return mapStoredRow(getRowsRange(rowIndex, rowIndex + 1)[0] ?? getRow(rowIndex));
  }, [getRow, getRowsRange]);
  getRowDataRef.current = getRowData;

  const runCellPrimaryAction = useCallback((colIndex: number, rowIndex: number): boolean => {
    const dataIndex = getDataIndex(colIndex);
    if (dataIndex < 0 || dataIndex >= columns.length) return false;
    const rowData = getRowData(rowIndex);
    return onCellPrimaryAction({ columnIndex: dataIndex, value: getCellValue(rowData, dataIndex), columnType: columns[dataIndex]?.type ?? "any" });
  }, [columns, getDataIndex, getRowData, onCellPrimaryAction]);

  const hasCellLink = useCallback((colIndex: number, rowIndex: number): boolean => {
    const dataIndex = getDataIndex(colIndex);
    const column = columns[dataIndex];
    if (!column) return false;
    const rowData = getRowData(rowIndex);
    return resolveCellLink({ value: getCellValue(rowData, dataIndex), columnType: column.type }) != null;
  }, [columns, getDataIndex, getRowData, resolveCellLink]);

  const getCellContent = useCallback((cell: Item): GridCell => {
    const [colIndex, rowIndex] = cell;
    const dataIndex = getDataIndex(colIndex);
    const column = columns[dataIndex];
    if (!column) {
      return { kind: GridCellKind.Text, allowOverlay: false, readonly: true, displayData: "", data: "" };
    }
    const rowData = getRowData(rowIndex);
    const value = getCellValue(rowData, dataIndex);
    const isNull = value === null || value === undefined;
    const displayValue = resolveCellDisplayValue(column.type, value);
    const link = resolveCellLink({ value, columnType: column.type });
    const selected = selectionRef.current != null && isCellSelected(selectionRef.current, rowIndex, dataIndex);
    const cellKey = `${rowIndex}:${dataIndex}`;
    const isSearchMatch = internalSearchMatchSet.has(cellKey);
    const isActiveSearchMatch = searchActiveMatch?.row === rowIndex && searchActiveMatch?.col === dataIndex;
    let themeOverride: Record<string, string> | undefined;
    if (isActiveSearchMatch) {
      themeOverride = { bgCell: "rgba(255, 180, 0, 0.45)" };
    } else if (isSearchMatch) {
      themeOverride = { bgCell: "rgba(255, 200, 0, 0.25)" };
    } else if (selected) {
      themeOverride = { bgCell: "rgba(100, 160, 255, 0.22)" };
    } else if (isNull) {
      themeOverride = { bgCell: isDarkTheme ? "rgba(128, 100, 0, 0.35)" : "rgba(255, 255, 200, 0.55)" };
    }
    const base = {
      allowOverlay: false,
      readonly: true,
      displayData: displayValue,
      data: displayValue,
      copyData: displayValue,
      themeOverride,
    };
    if (link != null) {
      return {
        ...base,
        kind: GridCellKind.Text,
        cursor: "pointer",
        themeOverride: {
          ...themeOverride,
          textDark: theme.linkColor,
        },
        hoverEffect: true,
      };
    }
    return { ...base, kind: GridCellKind.Text };
  }, [columns, getDataIndex, getRowData, resolveCellDisplayValue, resolveCellLink, isDarkTheme, theme.linkColor, internalSearchMatchSet, searchActiveMatch]);

  const collectSelectionSnapshot = useCallback((model: SelectionModel): GridComponentSelectionSnapshot | null => {
    const box = getBoundingBox(model, columns.length);
    if (!box) return null;
    const rowsByIndex: Array<GridComponentRow | undefined> = [];
    for (let row = box.rowStart; row <= box.rowEnd; row++) {
      rowsByIndex[row] = getRowData(row);
    }
    return { model, rowsByIndex, colOrder: columnOrder ?? undefined };
  }, [columns.length, getRowData, columnOrder]);

  const onGridSelectionChange = useCallback((newGlideSelection: GridSelection) => {
    const hasReordered = !!columnOrder;
    const next = fromGlideSelection(newGlideSelection, columns.length, getDataIndex, hasReordered);
    setGlideSelection(newGlideSelection);
    previousSelectionRef.current = selectionRef.current;
    selectionRef.current = next.selection;
    anchorRef.current = next.anchor;
    setSelection(next.selection);
    onSelectionChange?.(next.selection, next.anchor);
  }, [columnOrder, columns.length, getDataIndex, onSelectionChange]);

  const onColumnMoved = useCallback((startIndex: number, endIndex: number) => {
    setColumnOrder((current) => {
      const keys = current ?? columns.map((c) => c.key);
      if (startIndex < 0 || startIndex >= keys.length || endIndex < 0 || endIndex >= keys.length) return current;
      const reordered = [...keys];
      const [moved] = reordered.splice(startIndex, 1);
      reordered.splice(endIndex, 0, moved);
      const nextState = { ...gridStateRef.current, columnOrder: reordered };
      gridStateRef.current = nextState;
      onGridStateChange?.(nextState);
      return reordered;
    });
  }, [columns, onGridStateChange]);

  const onHeaderClicked = useCallback((colIndex: number) => {
    if (isStreaming || isSortingGuardRef.current) return;
    isSortingGuardRef.current = true;

    const dataIndex = getDataIndex(colIndex);
    const column = columns[dataIndex];
    if (!column) {
      isSortingGuardRef.current = false;
      return;
    }

    const alreadySorted = sortColumnKey === column.key;

    let ascending: boolean;
    if (!alreadySorted) {
      setSortColumnKey(column.key);
      setSortDirection("asc");
      ascending = true;
    } else if (sortDirection === "asc") {
      setSortDirection("desc");
      ascending = false;
    } else {
      setSortColumnKey(null);
      setSortDirection(null);
      sortedRowsRef.current = null;
      isSortingGuardRef.current = false;
      const visible = visibleRegionRef.current;
      if (visible && gridRef.current) {
        refreshVisibleRows(visible.y, visible.y + visible.height + 1);
        const cells: Array<{ cell: Item }> = [];
        const rowEnd = Math.min(getRowCount(), visible.y + visible.height + 1);
        const colEnd = Math.min(columns.length, visible.x + visible.width + 1);
        for (let row = visible.y; row < rowEnd; row++) {
          for (let col = visible.x; col < colEnd; col++) {
            cells.push({ cell: [col, row] });
          }
        }
        if (cells.length > 0) {
          gridRef.current.updateCells(cells);
        }
      }
      return;
    }

    setIsSorting(true);

    if (sortTimeoutRef.current !== null) {
      window.clearTimeout(sortTimeoutRef.current);
    }
    sortTimeoutRef.current = window.setTimeout(() => {
      sortTimeoutRef.current = null;
      const count = getRowCount();
      const allRows = getRowsRange(0, count);
      const indices = Array.from({ length: count }, (_, i) => i);
      const sortStart = performance.now();
      indices.sort((a, b) => {
        const valA = allRows[a]?.[dataIndex] ?? null;
        const valB = allRows[b]?.[dataIndex] ?? null;
        return compareValues(valA, valB) * (ascending ? 1 : -1);
      });
      const sortElapsed = performance.now() - sortStart;
      sortedRowsRef.current = indices.map((i) => allRows[i]);
      isSortingGuardRef.current = false;
      if (sortElapsed < 50) {
        setIsSorting(false);
      }
      const visible = visibleRegionRef.current;
      if (visible && gridRef.current) {
        refreshVisibleRows(visible.y, visible.y + visible.height + 1);
        const cells: Array<{ cell: Item }> = [];
        const rowEnd = Math.min(count, visible.y + visible.height + 1);
        const colEnd = Math.min(columns.length, visible.x + visible.width + 1);
        for (let row = visible.y; row < rowEnd; row++) {
          for (let col = visible.x; col < colEnd; col++) {
            cells.push({ cell: [col, row] });
          }
        }
        if (cells.length > 0) {
          gridRef.current.updateCells(cells);
        }
      }
      if (sortElapsed >= 50) {
        window.setTimeout(() => {
          setIsSorting(false);
        }, 200);
      }
    }, 0);
  }, [isStreaming, sortColumnKey, sortDirection, columns, getDataIndex, getRowCount, getRowsRange, refreshVisibleRows]);

  const onCellClicked = useCallback((cell: Item, event: CellClickedEventArgs) => {
    const [visCol, rowIndex] = cell;
    lastClickedCellRef.current = [visCol, rowIndex];
    clickCountRef.current++;
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickCountRef.current = 0;
      clickTimerRef.current = null;
    }, 300);
    isKeyboardActivationRef.current = false;
    const colIndex = getDataIndex(visCol);
    if (!isPrimaryModifier(event) && !event.shiftKey && colIndex >= 0 && hasCellLink(visCol, rowIndex) && runCellPrimaryAction(visCol, rowIndex)) {
      return;
    }
    if (!isPrimaryModifier(event) && !event.shiftKey) return;
    event.preventDefault();
    const existing = previousSelectionRef.current ?? selectionRef.current;
    const next = computeNextSelectionFromClick({ mouseEvent: event, rowIndex, colIndex, totalCols: columns.length, existing, anchor: anchorRef.current });
    if (!next.shouldApply) return;
    applySelection(next.selection, next.anchor);
  }, [applySelection, columns.length, getDataIndex, hasCellLink, runCellPrimaryAction]);

  const onCellActivated = useCallback((cell: Item) => {
    const [visCol, rowIndex] = cell;
    if (isKeyboardActivationRef.current) {
      isKeyboardActivationRef.current = false;
      runCellPrimaryAction(visCol, rowIndex);
    } else if (clickCountRef.current >= 2 && lastClickedCellRef.current !== null && lastClickedCellRef.current[0] === visCol && lastClickedCellRef.current[1] === rowIndex) {
      clickCountRef.current = 0;
      runCellPrimaryAction(visCol, rowIndex);
    }
  }, [runCellPrimaryAction]);

  const onCellContextMenu = useCallback((cell: Item, event: CellClickedEventArgs) => {
    const [visCol, rowIndex] = cell;
    const colIndex = getDataIndex(visCol);
    let model = selectionRef.current;
    if (!model || !isCellSelected(model, rowIndex, colIndex)) {
      model = { rect: computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, columns.length), cells: [] };
      applySelection(model, { row: rowIndex, colIndex });
    }
    const snapshot = collectSelectionSnapshot(model);
    if (!snapshot) return;
    event.preventDefault();
    onContextMenuSelection({
      clientX: event.bounds.x + event.localEventX,
      clientY: event.bounds.y + event.localEventY,
      preventDefault: event.preventDefault,
    }, snapshot);
  }, [applySelection, collectSelectionSnapshot, columns.length, getDataIndex, onContextMenuSelection]);

  useEffect(() => {
    const applyRowsChanged = (resetSort: boolean, force = false) => {
      pendingRowRefreshRef.current = null;
      const nextRowCount = getRowCount();
      if (!force && nextRowCount === rowCountRef.current) return;
      rowCountRef.current = nextRowCount;
      if (resetSort && sortedRowsRef.current !== null) {
        sortedRowsRef.current = null;
        setSortColumnKey(null);
        setSortDirection(null);
      }
      setRowCount(nextRowCount);
      const visible = visibleRegionRef.current;
      if (!visible || !gridRef.current) return;
      refreshVisibleRows(visible.y, visible.y + visible.height + 1);
      const cells: Array<{ cell: Item }> = [];
      const rowEnd = Math.min(nextRowCount, visible.y + visible.height + 1);
      const colEnd = Math.min(columns.length, visible.x + visible.width + 1);
      for (let row = visible.y; row < rowEnd; row++) {
        for (let col = visible.x; col < colEnd; col++) {
          cells.push({ cell: [col, row] });
        }
      }
      if (cells.length > 0) {
        gridRef.current.updateCells(cells);
      }
    };

    const unsubscribe = subscribeRowsChanged(() => {
      if (pendingRowRefreshRef.current !== null) {
        return;
      }
      pendingRowRefreshRef.current = window.setTimeout(() => applyRowsChanged(true, true), ROW_REFRESH_THROTTLE_MS);
    });
    applyRowsChanged(false);
    return unsubscribe;
  }, [columns.length, getRowCount, refreshVisibleRows, subscribeRowsChanged]);

  useEffect(() => {
    return () => {
      if (pendingRowRefreshRef.current !== null) {
        window.clearTimeout(pendingRowRefreshRef.current);
        pendingRowRefreshRef.current = null;
      }
      if (pendingAutoSizeTimerRef.current !== null) {
        window.clearTimeout(pendingAutoSizeTimerRef.current);
        pendingAutoSizeTimerRef.current = null;
      }
      if (sortTimeoutRef.current !== null) {
        window.clearTimeout(sortTimeoutRef.current);
        sortTimeoutRef.current = null;
      }
      activeCancelRef.current?.();
      activeCancelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !isPrimaryModifier(event) && !event.shiftKey && !event.altKey) {
        isKeyboardActivationRef.current = true;
        return;
      }
      if (!isPrimaryModifier(event) || event.key !== "c") return;
      const model = selectionRef.current;
      if (!model) return;
      const snapshot = collectSelectionSnapshot(model);
      if (!snapshot) return;
      event.preventDefault();
      event.stopPropagation();
      onCopySelection(snapshot);
    };
    el.addEventListener("keydown", handler, true);
    return () => {
      el.removeEventListener("keydown", handler, true);
    };
  }, [collectSelectionSnapshot, onCopySelection]);

  const prevActiveMatchRef = useRef<{ row: number; col: number } | null>(null);
  useEffect(() => {
    if (!searchActiveMatch || !gridRef.current) {
      prevActiveMatchRef.current = null;
      return;
    }
    const prev = prevActiveMatchRef.current;
    if (prev && prev.row === searchActiveMatch.row && prev.col === searchActiveMatch.col) return;
    prevActiveMatchRef.current = { row: searchActiveMatch.row, col: searchActiveMatch.col };
    const visualCol = getVisualIndex(searchActiveMatch.col);
    gridRef.current.scrollTo(visualCol, searchActiveMatch.row);
  }, [searchActiveMatch, getVisualIndex]);

  useEffect(() => {
    if (!searchMarkAll || !searchText) {
      setInternalSearchMatches([]);
      onSearchMatchesUpdateRef.current?.([]);
      return;
    }
    const timer = setTimeout(() => {
      const count = getRowCountRef.current();
      const currentColumns = columnsRef.current;
      const resolveFn = resolveCellDisplayValueRef.current;
      const newMatches: Array<{ row: number; col: number }> = [];
      for (let row = 0; row < count; row++) {
        const rowData = getRowDataRef.current(row);
        if (!rowData || !Array.isArray(rowData.__values)) continue;
        for (let col = 0; col < currentColumns.length; col++) {
          const value = resolveFn(currentColumns[col].type, rowData.__values[col] ?? null);
          if (matchesSearch(value, searchText, searchCaseSensitive, searchRegex, searchWholeWord)) {
            newMatches.push({ row, col });
          }
        }
      }
      setInternalSearchMatches(newMatches);
      onSearchMatchesUpdateRef.current?.(newMatches);
    }, 150);
    return () => clearTimeout(timer);
  }, [searchMarkAll, searchText, searchCaseSensitive, searchRegex, searchWholeWord, rowCount]);

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%", position: "relative" }}>
      <DataEditor
        ref={gridRef}
        width="100%"
        height="100%"
        columns={glideColumns}
        rows={Math.max(0, rowCount)}
        getCellContent={getCellContent}
        gridSelection={glideSelection}
        onGridSelectionChange={onGridSelectionChange}
        onCellClicked={onCellClicked}
        onCellActivated={onCellActivated}
        onCellContextMenu={onCellContextMenu}
        onHeaderClicked={onHeaderClicked}
        onVisibleRegionChanged={(range) => {
          visibleRegionRef.current = range;
          refreshVisibleRows(range.y, range.y + range.height + 1);
          const nextState = { ...gridStateRef.current, scrollOffset: resolveScrollOffsetFromVisibleRegion(range, glideColumns) };
          gridStateRef.current = nextState;
          onGridStateChange?.(nextState);
        }}
        onColumnResize={(column, newSize) => {
          const columnId = column.id;
          if (!columnId) return;
          setColumnWidths((current) => {
            const next = { ...current, [columnId]: newSize };
            const nextState = { ...gridStateRef.current, columnWidths: next };
            gridStateRef.current = nextState;
            onGridStateChange?.(nextState);
            return next;
          });
        }}
        onColumnMoved={onColumnMoved}
        scrollOffsetX={initialGridState?.scrollOffset?.x}
        scrollOffsetY={initialGridState?.scrollOffset?.y}
        rowMarkers={{ kind: "clickable-number", width: rowNumberWidth, startIndex: 1 }}
        rowHeight={ROW_HEIGHT_PX}
        headerHeight={HEADER_HEIGHT_PX}
        smoothScrollX={true}
        smoothScrollY={true}
        overscrollX={0}
        overscrollY={0}
        rangeSelect="multi-rect"
        rangeSelectionBlending="mixed"
        columnSelect="none"
        rowSelect="multi"
        drawFocusRing={false}
        fillHandle={false}
        onPaste={false}
        maxColumnWidth={5000}
        theme={theme}
      />
      {isSorting && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.25)",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          <div className="grid-component-spinner" />
        </div>
      )}
    </div>
  );
});
