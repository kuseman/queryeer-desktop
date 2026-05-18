import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type {
  CellClassParams,
  CellClickedEvent,
  CellDoubleClickedEvent,
  CellKeyDownEvent,
  CellMouseDownEvent,
  CellMouseOverEvent,
  ColDef,
  FirstDataRenderedEvent,
  GridApi,
  GridReadyEvent,
  GridState,
  IDatasource,
  ICellRendererParams,
  IGetRowsParams,
  StateUpdatedEvent,
} from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry, colorSchemeDark, colorSchemeLight, themeQuartz } from "ag-grid-community";
import { computeSelection, extendSelection, getBoundingBox, isCellSelected, isRowSelected } from "../../plugins/core.queryengine.output.table/clipboard/CellSelectionModel";
import type { SelectionAnchor, SelectionModel } from "../../plugins/core.queryengine.output.table/clipboard/CellSelectionModel";

ModuleRegistry.registerModules([AllCommunityModule]);

const compactDarkTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  rowHeight: 24,
  headerHeight: 26,
  rowVerticalPaddingScale: 0.5,
  cellHorizontalPaddingScale: 0.75,
  fontSize: 12,
});

const compactLightTheme = themeQuartz.withPart(colorSchemeLight).withParams({
  rowHeight: 24,
  headerHeight: 26,
  rowVerticalPaddingScale: 0.5,
  cellHorizontalPaddingScale: 0.75,
  fontSize: 12,
});

export type GridComponentColumn = {
  key: string;
  title: string;
  type: string;
};

export type GridComponentState = GridState;

export type GridComponentRow = {
  __values: unknown[];
};

export type GridComponentSelectionSnapshot = {
  model: SelectionModel;
  rowsByIndex: Array<GridComponentRow | undefined>;
};

export type GridComponentProps = {
  columns: GridComponentColumn[];
  rowNumberWidth?: number;
  getRowCount: () => number;
  getRowsRange: (start: number, end: number) => unknown[][];
  getRow: (index: number) => unknown[] | undefined;
  subscribeRowsChanged: (listener: () => void) => () => void;
  getInitialSelection?: () => { selection: SelectionModel | null; anchor: SelectionAnchor | null };
  onSelectionChange?: (selection: SelectionModel | null, anchor: SelectionAnchor | null) => void;
  getInitialGridState?: () => GridState | undefined;
  onGridStateChange?: (state: GridState) => void;
  resolveCellDisplayValue: (type: string, value: unknown) => string;
  resolveCellLink: (options: { value: unknown; columnType: string }) => unknown;
  onCellPrimaryAction: (options: { columnIndex: number; value: unknown; columnType: string }) => boolean;
  onCopySelection: (snapshot: GridComponentSelectionSnapshot) => void;
  onContextMenuSelection: (event: MouseEvent, snapshot: GridComponentSelectionSnapshot) => void;
  isDarkTheme: boolean;
};

const ROW_NUMBER_COL_ID = "__rownum__";
const DEFAULT_ROW_NUMBER_COL_WIDTH_PX = 78;

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

function isPrimaryMouseButton(event: MouseEvent | null): boolean {
  return event == null || event.button === 0;
}

function computeNextSelectionFromClick(input: {
  mouseEvent: MouseEvent | null;
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
  const ctrl = !!(mouseEvent?.ctrlKey || mouseEvent?.metaKey);
  let nextSelection: SelectionModel | null = existing;
  let nextAnchor: SelectionAnchor | null = anchor;
  if (shift && ctrl) {
    const prevRect = existing?.rect ?? computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, totalCols);
    nextSelection = { rect: extendSelection(prevRect, { row: rowIndex, colIndex }, totalCols), cells: existing?.cells ?? [] };
    nextAnchor = { row: rowIndex, colIndex };
  } else if (shift) {
    if (anchor !== null) {
      nextSelection = { rect: computeSelection(anchor, { row: rowIndex, colIndex }, totalCols), cells: existing?.cells ?? [] };
    }
  } else if (ctrl) {
    const cells = existing?.cells ?? [];
    const already = cells.some((c) => c.row === rowIndex && c.colIndex === colIndex);
    nextSelection = { rect: existing?.rect ?? null, cells: already ? cells : [...cells, { row: rowIndex, colIndex }] };
    nextAnchor = { row: rowIndex, colIndex };
  } else {
    nextAnchor = { row: rowIndex, colIndex };
    nextSelection = { rect: computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, totalCols), cells: [] };
  }
  return { shouldApply: true, selection: nextSelection, anchor: nextAnchor };
}

export function GridComponent({
  columns,
  rowNumberWidth = DEFAULT_ROW_NUMBER_COL_WIDTH_PX,
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
}: GridComponentProps): JSX.Element {
  const apiRef = useRef<GridApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const appliedCountRef = useRef(0);
  const pendingRowCountRefreshRef = useRef<number | null>(null);
  const [selection, setSelection] = useState<SelectionModel | null>(() => getInitialSelection?.().selection ?? null);
  const selectionRef = useRef<SelectionModel | null>(null);
  selectionRef.current = selection;
  const anchorRef = useRef<SelectionAnchor | null>(getInitialSelection?.().anchor ?? null);
  const isDraggingRef = useRef(false);
  const didDragMoveRef = useRef(false);

  const createDatasource = useCallback((): IDatasource => ({
    rowCount: getRowCount(),
    getRows: (params: IGetRowsParams) => {
      const rows = getRowsRange(params.startRow, params.endRow).map((row) => mapRow(row));
      params.successCallback(rows, getRowCount());
    }
  }), [getRowCount, getRowsRange]);

  const colDefs = useMemo<ColDef[]>(() => {
    const rowNumCol: ColDef = {
      colId: ROW_NUMBER_COL_ID,
      headerName: "#",
      width: rowNumberWidth,
      minWidth: rowNumberWidth,
      maxWidth: rowNumberWidth,
      resizable: false,
      sortable: false,
      filter: false,
      suppressMovable: true,
      pinned: "left" as const,
      cellClassRules: {
        "table-cell-selected": (params: CellClassParams) =>
          selectionRef.current != null && params.rowIndex != null && isRowSelected(selectionRef.current, params.rowIndex),
      },
      cellRenderer: (params: ICellRendererParams) => <span className="table-row-number">{(params.node.rowIndex ?? 0) + 1}</span>,
    };
    return [
      rowNumCol,
      ...columns.map((col, index): ColDef => ({
        colId: col.key,
        valueGetter: (params) => getCellValue(params.data as GridComponentRow | undefined, index),
        headerName: col.title,
        headerTooltip: col.type,
        resizable: true,
        sortable: true,
        filter: resolveFilterType(col.type),
        valueFormatter: (params) => resolveCellDisplayValue(col.type, params.value),
        minWidth: 60,
      }))
    ];
  }, [columns, resolveCellDisplayValue, rowNumberWidth]);

  const defaultColDef = useMemo<ColDef>(() => ({
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 60,
    cellClassRules: {
      "table-cell-selected": (params: CellClassParams) => {
        const model = selectionRef.current;
        if (model == null || params.rowIndex == null) return false;
        const colIdx = columns.findIndex((c) => c.key === params.column.getColId());
        return colIdx !== -1 && isCellSelected(model, params.rowIndex, colIdx);
      },
      "table-cell-link": (params: CellClassParams) => {
        if (params.rowIndex == null) return false;
        const colIdx = columns.findIndex((c) => c.key === params.column.getColId());
        if (colIdx < 0) return false;
        const value = getCellValue(params.data as GridComponentRow | undefined, colIdx);
        return resolveCellLink({ value, columnType: columns[colIdx]?.type ?? "any" }) != null;
      },
    },
  }), [columns, resolveCellLink]);

  const applySelection = useCallback((newSel: SelectionModel | null, api: GridApi) => {
    selectionRef.current = newSel;
    setSelection(newSel);
    onSelectionChange?.(newSel, anchorRef.current);
    api.refreshCells({ force: true });
  }, [onSelectionChange]);

  const onGridReady = useCallback((params: GridReadyEvent) => {
    apiRef.current = params.api;
    params.api.setGridOption("datasource", createDatasource());
    appliedCountRef.current = getRowCount();
    const savedState = getInitialGridState?.();
    if (savedState) {
      (params.api as unknown as { setState?: (state: GridState) => void }).setState?.(savedState);
    }
  }, [createDatasource, getInitialGridState, getRowCount]);

  const onFirstDataRendered = useCallback((params: FirstDataRenderedEvent) => {
    if (selectionRef.current) params.api.refreshCells({ force: true });
  }, []);

  const onStateUpdated = useCallback((event: StateUpdatedEvent) => {
    onGridStateChange?.(event.state);
  }, [onGridStateChange]);

  const selectSingleCell = useCallback((e: CellMouseDownEvent | CellClickedEvent) => {
    const colId = e.column.getColId();
    const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : columns.findIndex((c) => c.key === colId);
    const rowIndex = e.node.rowIndex ?? 0;
    anchorRef.current = { row: rowIndex, colIndex };
    applySelection({ rect: computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, columns.length), cells: [] }, e.api);
  }, [applySelection, columns]);

  const onCellMouseDown = useCallback((e: CellMouseDownEvent) => {
    const me = e.event as MouseEvent | null;
    if (!isPrimaryMouseButton(me)) {
      if (me?.button === 2) {
        const colId = e.column.getColId();
        const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : columns.findIndex((c) => c.key === colId);
        const rowIndex = e.node.rowIndex ?? 0;
        const model = selectionRef.current;
        if (!model || !isCellSelected(model, rowIndex, colIndex)) {
          selectSingleCell(e);
        }
      }
      return;
    }
    if (me?.shiftKey || me?.ctrlKey || me?.metaKey) return;
    isDraggingRef.current = true;
    didDragMoveRef.current = false;
    selectSingleCell(e);
  }, [columns, selectSingleCell]);

  const onCellMouseOver = useCallback((e: CellMouseOverEvent) => {
    if (!isDraggingRef.current || !anchorRef.current) return;
    const colId = e.column.getColId();
    const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : columns.findIndex((c) => c.key === colId);
    const rowIndex = e.node.rowIndex ?? 0;
    didDragMoveRef.current = true;
    applySelection({ rect: computeSelection(anchorRef.current, { row: rowIndex, colIndex }, columns.length), cells: [] }, e.api);
  }, [applySelection, columns]);

  const onCellClicked = useCallback((e: CellClickedEvent) => {
    if (didDragMoveRef.current) {
      didDragMoveRef.current = false;
      return;
    }
    const me = e.event as MouseEvent | null;
    const colId = e.column.getColId();
    const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : columns.findIndex((c) => c.key === colId);
    const rowIndex = e.node.rowIndex ?? 0;
    if (colIndex >= 0) {
      const value = getCellValue(e.data as GridComponentRow | undefined, colIndex);
      if (onCellPrimaryAction({ columnIndex: colIndex, value, columnType: columns[colIndex]?.type ?? "any" })) {
        return;
      }
    }
    const next = computeNextSelectionFromClick({ mouseEvent: me, rowIndex, colIndex, totalCols: columns.length, existing: selectionRef.current, anchor: anchorRef.current });
    if (!next.shouldApply) return;
    anchorRef.current = next.anchor;
    applySelection(next.selection, e.api);
  }, [applySelection, columns, onCellPrimaryAction]);

  const runCellPrimaryAction = useCallback((columnId: string, rowData: GridComponentRow | undefined): boolean => {
    const colIndex = columnId === ROW_NUMBER_COL_ID ? -1 : columns.findIndex((c) => c.key === columnId);
    if (colIndex < 0) return false;
    return onCellPrimaryAction({ columnIndex: colIndex, value: getCellValue(rowData, colIndex), columnType: columns[colIndex]?.type ?? "any" });
  }, [columns, onCellPrimaryAction]);

  const onCellDoubleClicked = useCallback((e: CellDoubleClickedEvent) => {
    void runCellPrimaryAction(e.column.getColId(), e.data as GridComponentRow | undefined);
  }, [runCellPrimaryAction]);

  const onCellKeyDown = useCallback((e: CellKeyDownEvent) => {
    const keyboardEvent = e.event as KeyboardEvent | null;
    if (!keyboardEvent || keyboardEvent.key !== "Enter") return;
    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
    void runCellPrimaryAction(e.column.getColId(), e.data as GridComponentRow | undefined);
  }, [runCellPrimaryAction]);

  useEffect(() => {
    return subscribeRowsChanged(() => {
      const api = apiRef.current;
      if (!api) return;
      const rowCount = getRowCount();
      if (rowCount === appliedCountRef.current) return;
      appliedCountRef.current = rowCount;
      if (pendingRowCountRefreshRef.current !== null) return;
      pendingRowCountRefreshRef.current = window.setTimeout(() => {
        pendingRowCountRefreshRef.current = null;
        apiRef.current?.setRowCount(getRowCount(), true);
      }, 100);
    });
  }, [getRowCount, subscribeRowsChanged]);

  useEffect(() => {
    const stop = () => { isDraggingRef.current = false; };
    document.addEventListener("mouseup", stop);
    return () => document.removeEventListener("mouseup", stop);
  }, []);

  useEffect(() => {
    return () => {
      if (pendingRowCountRefreshRef.current !== null) {
        window.clearTimeout(pendingRowCountRefreshRef.current);
        pendingRowCountRefreshRef.current = null;
      }
      apiRef.current = null;
      appliedCountRef.current = 0;
    };
  }, []);

  function collectSelectionSnapshot(model: SelectionModel): GridComponentSelectionSnapshot | null {
    const box = getBoundingBox(model, columns.length);
    if (!box) return null;
    const rowsByIndex: Array<GridComponentRow | undefined> = [];
    for (let r = box.rowStart; r <= box.rowEnd; r++) {
      rowsByIndex[r] = mapStoredRow(getRow(r));
    }
    return { model, rowsByIndex };
  }

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== "c") return;
      const model = selectionRef.current;
      if (!model) return;
      const snapshot = collectSelectionSnapshot(model);
      if (!snapshot) return;
      e.preventDefault();
      e.stopPropagation();
      onCopySelection(snapshot);
    };
    el.addEventListener("keydown", handler, true);
    return () => el.removeEventListener("keydown", handler, true);
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const openContextMenu = (e: MouseEvent) => {
      const model = selectionRef.current;
      if (!model) return;
      const snapshot = collectSelectionSnapshot(model);
      if (!snapshot) return;
      e.preventDefault();
      onContextMenuSelection(e, snapshot);
    };
    el.addEventListener("contextmenu", openContextMenu, true);
    return () => el.removeEventListener("contextmenu", openContextMenu, true);
  });

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%" }}>
      <AgGridReact
        theme={isDarkTheme ? compactDarkTheme : compactLightTheme}
        columnDefs={colDefs}
        defaultColDef={defaultColDef}
        onGridReady={onGridReady}
        onFirstDataRendered={onFirstDataRendered}
        onStateUpdated={onStateUpdated}
        onCellMouseDown={onCellMouseDown}
        onCellMouseOver={onCellMouseOver}
        onCellClicked={onCellClicked}
        onCellDoubleClicked={onCellDoubleClicked}
        onCellKeyDown={onCellKeyDown}
        rowModelType="infinite"
        cacheBlockSize={200}
        maxBlocksInCache={20}
        rowBuffer={30}
        suppressMovableColumns={false}
      />
    </div>
  );
}

export function resolveFilterType(type: string): string | boolean {
  if (type === "boolean") return "agSetColumnFilter";
  if (type === "int" || type === "long" || type === "decimal" || type === "float" || type === "double") return "agNumberColumnFilter";
  if (type === "datetime" || type === "datetimeoffset") return "agDateColumnFilter";
  return "agTextColumnFilter";
}
