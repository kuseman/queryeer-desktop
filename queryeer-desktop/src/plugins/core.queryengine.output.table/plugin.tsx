import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, GridReadyEvent, FirstDataRenderedEvent, StateUpdatedEvent, ICellRendererParams, CellClickedEvent, CellClassParams, CellMouseDownEvent, CellMouseOverEvent, CellDoubleClickedEvent, CellKeyDownEvent } from "ag-grid-community";
import type { GridState } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry, themeQuartz, colorSchemeDark, colorSchemeLight } from "ag-grid-community";
import type { Plugin } from "../../contracts/plugin/Plugin";
import type { OutputContext, Column } from "../../contracts/extensions/OutputExtension";
import { DEFAULT_OUTPUT_LIMITS } from "../../contracts/extensions/OutputExtension";
import { getOutputRegistry } from "../core.queryengine/output/OutputRegistry";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import { getTableOutputContextMenuProviders } from "../../core/plugin-runtime/ExtensionRegistry";
import { defineStateKey } from "../../contracts/files/FileStateRegistry";
import { writeToClipboard } from "./clipboard/ClipboardRegistry";
import { computeSelection, extendSelection, isCellSelected, isRowSelected, getBoundingBox } from "./clipboard/CellSelectionModel";
import type { SelectionAnchor, SelectionModel } from "./clipboard/CellSelectionModel";
import outputTableIconUrl from "./output-table.svg";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../core.settings/service";
import {
  OUTPUT_TABLE_STACKED_MAX_ROWS_SETTING_ID,
  OUTPUT_TABLE_VIEW_MODE_SETTING_ID,
  resolveOutputTableSettings,
} from "./output-table-settings";
import {
  formatPreviewValue,
  inferPreviewMimeType,
  resolveTableLinkAction,
} from "./table-link-actions";
import { getThemeService } from "../core.themes/runtime";
import { evaluateWhenExpression } from "../core.commands/when-evaluator";
import { getCommandContext } from "../core.commands/command-context-accessor";
import { flattenContextObject } from "../../renderer/shell/context-value-flatten";
import type {
  TableOutputContextMenuContext,
  TableOutputContextMenuItem,
  TableOutputContextMenuProvider,
  TableOutputSelectionSnapshot,
} from "../../contracts/extensions/TableOutputContextMenuExtension";
import { ContextMenuSurface } from "../../renderer/components/ContextMenuSurface";

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

const GRID_STATE_KEY = defineStateKey<GridState>("core.queryengine.output.table.gridState");
const ACTIVE_RESULT_SET_KEY = defineStateKey<number>("core.queryengine.output.table.activeResultSet");

type SavedSelection = { selection: SelectionModel | null; anchor: SelectionAnchor | null };
const SELECTION_KEY = defineStateKey<Record<number, SavedSelection>>("core.queryengine.output.table.selection");

type GridColumn = {
  key: string;
  title: string;
  type: string;
};

function toGridColumns(columns: Column[]): GridColumn[] {
  const used = new Set<string>();
  return columns.map((col, i) => {
    const base = col.name && col.name.trim().length > 0 ? col.name : `col_${i + 1}`;
    let key = base;
    let suffix = 2;
    while (used.has(key)) {
      key = `${base}_${suffix}`;
      suffix += 1;
    }
    used.add(key);
    return {
      key,
      title: col.name && col.name.trim().length > 0 ? col.name : `Column ${i + 1}`,
      type: col.type
    };
  });
}

type GridRowData = {
  __values: unknown[];
};

export function toCsvScalar(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function isPrimaryMouseButton(event: MouseEvent | null): boolean {
  return event == null || event.button === 0;
}

export type SelectionClickInput = {
  mouseEvent: MouseEvent | null;
  rowIndex: number;
  colIndex: number;
  totalCols: number;
  existing: SelectionModel | null;
  anchor: SelectionAnchor | null;
};

export type SelectionClickResult = {
  shouldApply: boolean;
  selection: SelectionModel | null;
  anchor: SelectionAnchor | null;
};

export function computeNextSelectionFromClick(input: SelectionClickInput): SelectionClickResult {
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

export function buildSelectionSnapshot(
  model: SelectionModel,
  rowsByIndex: Array<GridRowData | undefined>,
  totalCols: number
): TableOutputSelectionSnapshot {
  const box = getBoundingBox(model, totalCols);
  if (!box) {
    return {
      hasSelection: false,
      selectedCells: [],
      selectedRowIndexes: [],
      selectedColumnIndexes: [],
      isSingleColumnSelection: false,
      isSingleRowSelection: false,
    };
  }

  const selectedCells: TableOutputSelectionSnapshot["selectedCells"] = [];
  const rowSet = new Set<number>();
  const colSet = new Set<number>();
  for (let row = box.rowStart; row <= box.rowEnd; row++) {
    for (let col = box.colIndexStart; col <= box.colIndexEnd; col++) {
      if (!isCellSelected(model, row, col)) continue;
      rowSet.add(row);
      colSet.add(col);
      selectedCells.push({ rowIndex: row, columnIndex: col, value: getCellValueForCopy(rowsByIndex[row], col) });
    }
  }
  const selectedRowIndexes = [...rowSet].sort((a, b) => a - b);
  const selectedColumnIndexes = [...colSet].sort((a, b) => a - b);
  return {
    hasSelection: selectedCells.length > 0,
    selectedCells,
    selectedRowIndexes,
    selectedColumnIndexes,
    isSingleColumnSelection: selectedColumnIndexes.length === 1,
    isSingleRowSelection: selectedRowIndexes.length === 1,
  };
}

async function resolveTableContextMenuItems(
  providers: TableOutputContextMenuProvider[],
  context: TableOutputContextMenuContext
): Promise<TableOutputContextMenuItem[][]> {
  const baseContext = getCommandContext();
  const tableContext = flattenContextObject("tableSelection", {
    hasSelection: context.selection.hasSelection,
    selectedCellCount: context.selection.selectedCells.length,
    selectedRowCount: context.selection.selectedRowIndexes.length,
    selectedColumnCount: context.selection.selectedColumnIndexes.length,
    isSingleColumnSelection: context.selection.isSingleColumnSelection,
    isSingleRowSelection: context.selection.isSingleRowSelection,
  });
  const mergedContext = { ...baseContext, ...tableContext };

  const sections = await Promise.all(providers.map(async (provider) => {
    try {
      if (provider.when && !evaluateWhenExpression(provider.when, mergedContext)) {
        return [] as TableOutputContextMenuItem[];
      }
      const items = await provider.getItems(context);
      return items
        .filter((item) => !item.when || evaluateWhenExpression(item.when, mergedContext))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    } catch {
      return [] as TableOutputContextMenuItem[];
    }
  }));
  return sections.filter((section) => section.length > 0);
}

export function getCellValueForCopy(rowData: GridRowData | undefined, columnIndex: number): unknown {
  if (!rowData || !Array.isArray(rowData.__values)) {
    return null;
  }
  return rowData.__values[columnIndex] ?? null;
}

export function buildClipboardGridFromRows(
  rowsByIndex: Array<GridRowData | undefined>,
  box: { rowStart: number; rowEnd: number; colIndexStart: number; colIndexEnd: number },
  isSelected: (row: number, col: number) => boolean
): { value: unknown; selected: boolean }[][] {
  const grid: { value: unknown; selected: boolean }[][] = [];
  for (let r = box.rowStart; r <= box.rowEnd; r++) {
    const rowData = rowsByIndex[r];
    const gridRow: { value: unknown; selected: boolean }[] = [];
    for (let c = box.colIndexStart; c <= box.colIndexEnd; c++) {
      const selected = isSelected(r, c);
      const value = selected ? getCellValueForCopy(rowData, c) : null;
      gridRow.push({ value, selected });
    }
    grid.push(gridRow);
  }
  return grid;
}

function mapRow(row: unknown[]): GridRowData {
  return { __values: row };
}

const ROW_NUMBER_COL_ID = "__rownum__";
const STACKED_GRID_HEADER_HEIGHT_PX = 26;
const STACKED_GRID_ROW_HEIGHT_PX = 24;
const STACKED_GRID_EXTRA_CHROME_PX = 26;

function buildColDefs(columns: GridColumn[]): ColDef[] {
  return columns.map((col, index) => ({
    colId: col.key,
    valueGetter: (params) => {
      const data = params.data as GridRowData | undefined;
      const values = data?.__values;
      return Array.isArray(values) ? (values[index] ?? null) : null;
    },
    headerName: col.title,
    headerTooltip: col.type,
    resizable: true,
    sortable: true,
    filter: resolveFilterType(col.type),
    valueFormatter: (params) => resolveCellDisplayValue(col.type, params.value),
    minWidth: 60,
  }));
}

export function resolveFilterType(type: string): string | boolean {
  if (type === "boolean") {
    return "agSetColumnFilter";
  }
  if (type === "int" || type === "long" || type === "decimal" || type === "float" || type === "double") {
    return "agNumberColumnFilter";
  }
  if (type === "datetime" || type === "datetimeoffset") {
    return "agDateColumnFilter";
  }
  return "agTextColumnFilter";
}

export function resolveCellDisplayValue(type: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (type === "decimal") {
    return typeof value === "string" ? value : String(value);
  }

  if (type === "datetime" || type === "datetimeoffset") {
    return typeof value === "string" ? value : String(value);
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

type TableGridProps = {
  resultSetIndex: number;
  schema: { columns: Column[] };
  rows: unknown[][];
  fileId?: string;
  onPreviewValue: (options: { title: string; value: string; mimeType?: string }) => void;
};

function TableGrid({ resultSetIndex, schema, rows, fileId, onPreviewValue }: TableGridProps): JSX.Element {
  const apiRef = useRef<GridApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const appliedCountRef = useRef(0);
  const bindingRef = useRef<string>("");
  const gridColumns = useMemo(() => toGridColumns(schema.columns), [schema.columns]);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => (getThemeService()?.getActiveThemeMode() ?? "dark") === "dark");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; sections: TableOutputContextMenuItem[][]; loading?: boolean } | null>(null);

  useEffect(() => {
    const themeService = getThemeService();
    if (!themeService) {
      return;
    }
    setIsDarkTheme(themeService.getActiveThemeMode() === "dark");
    return themeService.subscribe(() => {
      setIsDarkTheme(themeService.getActiveThemeMode() === "dark");
    });
  }, []);

  // Custom rectangular cell selection — managed independently of AG Grid's row selection.
  const [selection, setSelection] = useState<SelectionModel | null>(() =>
    fileId ? (getFileStateRegistry().get(fileId, SELECTION_KEY)?.[resultSetIndex]?.selection ?? null) : null
  );
  // selectionRef mirrors state so useMemo cellClassRules closures can read it synchronously.
  const selectionRef = useRef<SelectionModel | null>(null);
  selectionRef.current = selection;
  const anchorRef = useRef<SelectionAnchor | null>(null);

  useEffect(() => {
    if (fileId) {
      anchorRef.current = getFileStateRegistry().get(fileId, SELECTION_KEY)?.[resultSetIndex]?.anchor ?? null;
    } else {
      anchorRef.current = null;
    }
  }, [fileId, resultSetIndex]);

  // Drag state: tracks whether a mouse-drag selection is in progress.
  const isDraggingRef = useRef(false);
  const didDragMoveRef = useRef(false);

  const applySelection = useCallback((newSel: SelectionModel | null, api: GridApi) => {
    selectionRef.current = newSel;
    setSelection(newSel);
    if (fileId) {
      const map = getFileStateRegistry().get(fileId, SELECTION_KEY) ?? {};
      getFileStateRegistry().set(fileId, SELECTION_KEY, {
        ...map,
        [resultSetIndex]: { selection: newSel, anchor: anchorRef.current },
      });
    }
    api.refreshCells({ force: true });
  }, [fileId, resultSetIndex]);

  // cellClassRules closures read selectionRef directly (ref is stable).
  // refreshCells({ force: true }) triggers re-evaluation after every change.
  const colDefs = useMemo<ColDef[]>(() => {
    const rowNumCol: ColDef = {
      colId: ROW_NUMBER_COL_ID,
      headerName: "#",
      width: 52,
      minWidth: 52,
      maxWidth: 52,
      resizable: false,
      sortable: false,
      filter: false,
      suppressMovable: true,
      pinned: "left" as const,
      cellClassRules: {
        "table-cell-selected": (params: CellClassParams) =>
          selectionRef.current != null && params.rowIndex != null &&
          isRowSelected(selectionRef.current, params.rowIndex),
      },
      cellRenderer: (params: ICellRendererParams) => (
        <span className="table-row-number">{(params.node.rowIndex ?? 0) + 1}</span>
      ),
    };
    return [rowNumCol, ...buildColDefs(gridColumns)];
  }, [gridColumns]);

  const defaultColDef = useMemo<ColDef>(() => ({
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 60,
    cellClassRules: {
      "table-cell-selected": (params: CellClassParams) => {
        const model = selectionRef.current;
        if (model == null || params.rowIndex == null) return false;
        const colIdx = gridColumns.findIndex((c) => c.key === params.column.getColId());
        return colIdx !== -1 && isCellSelected(model, params.rowIndex, colIdx);
      },
      "table-cell-link": (params: CellClassParams) => {
        if (params.rowIndex == null) return false;
        const colIdx = gridColumns.findIndex((c) => c.key === params.column.getColId());
        if (colIdx < 0) return false;
        const rowData = params.data as GridRowData | undefined;
        const value = getCellValueForCopy(rowData, colIdx);
        return resolveTableLinkAction({ value, columnType: schema.columns[colIdx]?.type ?? "any" }) != null;
      },
    },
  }), [gridColumns, schema.columns]);

  const onGridReady = useCallback(
    (params: GridReadyEvent) => {
      apiRef.current = params.api;
      params.api.setGridOption(
        "rowData",
        rowsRef.current.map((r) => mapRow(r))
      );
      appliedCountRef.current = rowsRef.current.length;
    },
    [gridColumns]
  );

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    const binding = `${fileId ?? ""}:${resultSetIndex}`;
    if (bindingRef.current === binding) return;
    bindingRef.current = binding;

    const savedSelection = fileId
      ? (getFileStateRegistry().get(fileId, SELECTION_KEY)?.[resultSetIndex] ?? { selection: null, anchor: null })
      : { selection: null, anchor: null };
    selectionRef.current = savedSelection.selection;
    setSelection(savedSelection.selection);
    anchorRef.current = savedSelection.anchor;

    api.setGridOption("rowData", rows.map((r) => mapRow(r)));
    appliedCountRef.current = rows.length;

    const savedState = fileId ? getFileStateRegistry().get(fileId, GRID_STATE_KEY) : undefined;
    if (savedState) {
      (api as unknown as { setState?: (state: GridState) => void }).setState?.(savedState);
    }
    api.refreshCells({ force: true });
  }, [fileId, resultSetIndex, rows, gridColumns]);

  // After AG Grid renders its first batch of rows, repaint cells so restored selection is visible.
  const onFirstDataRendered = useCallback((params: FirstDataRenderedEvent) => {
    if (selectionRef.current) params.api.refreshCells({ force: true });
  }, []);

  const onStateUpdated = useCallback(
    (event: StateUpdatedEvent) => {
      if (fileId) getFileStateRegistry().set(fileId, GRID_STATE_KEY, event.state);
    },
    [fileId]
  );

  const onCellMouseDown = useCallback(
    (e: CellMouseDownEvent) => {
      const me = e.event as MouseEvent | null;
      if (!isPrimaryMouseButton(me)) return;
      if (me?.shiftKey || me?.ctrlKey || me?.metaKey) return;
      const colId = e.column.getColId();
      const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : gridColumns.findIndex((c) => c.key === colId);
      const rowIndex = e.node.rowIndex ?? 0;
      isDraggingRef.current = true;
      didDragMoveRef.current = false;
      anchorRef.current = { row: rowIndex, colIndex };
      applySelection(
        { rect: computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, schema.columns.length), cells: [] },
        e.api
      );
    },
    [schema.columns.length, gridColumns, applySelection]
  );

  const onCellMouseOver = useCallback(
    (e: CellMouseOverEvent) => {
      if (!isDraggingRef.current || !anchorRef.current) return;
      const colId = e.column.getColId();
      const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : gridColumns.findIndex((c) => c.key === colId);
      const rowIndex = e.node.rowIndex ?? 0;
      didDragMoveRef.current = true;
      applySelection(
        { rect: computeSelection(anchorRef.current, { row: rowIndex, colIndex }, schema.columns.length), cells: [] },
        e.api
      );
    },
    [schema.columns.length, gridColumns, applySelection]
  );

  const onCellClicked = useCallback(
    (e: CellClickedEvent) => {
      if (didDragMoveRef.current) {
        didDragMoveRef.current = false;
        return;
      }
      const me = e.event as MouseEvent | null;
      const colId = e.column.getColId();
      const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : gridColumns.findIndex((c) => c.key === colId);
      const rowIndex = e.node.rowIndex ?? 0;
      const totalCols = schema.columns.length;

      if (colIndex >= 0) {
        const rowData = e.data as GridRowData | undefined;
        const value = getCellValueForCopy(rowData, colIndex);
        const action = resolveTableLinkAction({ value, columnType: schema.columns[colIndex]?.type ?? "any" });
        if (action) {
          if (action.kind === "external") {
            void window.appShell.openExternal(action.value);
          } else {
            onPreviewValue({
              title: action.title,
              value: action.value,
              mimeType: action.mimeType,
            });
          }
          return;
        }
      }

      const next = computeNextSelectionFromClick({
        mouseEvent: me,
        rowIndex,
        colIndex,
        totalCols,
        existing: selectionRef.current,
        anchor: anchorRef.current,
      });
      if (!next.shouldApply) {
        return;
      }
      anchorRef.current = next.anchor;
      applySelection(next.selection, e.api);
    },
    [schema, gridColumns, applySelection, onPreviewValue]
  );

  const runCellPrimaryAction = useCallback((columnId: string, rowData: GridRowData | undefined): boolean => {
    const colIndex = columnId === ROW_NUMBER_COL_ID ? -1 : gridColumns.findIndex((c) => c.key === columnId);
    if (colIndex < 0) {
      return false;
    }
    const rawValue = getCellValueForCopy(rowData, colIndex);
    const action = resolveTableLinkAction({ value: rawValue, columnType: schema.columns[colIndex]?.type ?? "any" });
    if (action) {
      if (action.kind === "external") {
        void window.appShell.openExternal(action.value);
      } else {
        onPreviewValue({
          title: action.title,
          value: action.value,
          mimeType: action.mimeType,
        });
      }
      return true;
    }

    const mimeType = inferPreviewMimeType(rawValue);
    const value = formatPreviewValue(rawValue, mimeType);
    onPreviewValue({
      title: "Value Preview",
      value,
      mimeType,
    });
    return true;
  }, [gridColumns, onPreviewValue, schema.columns]);

  const onCellDoubleClicked = useCallback((e: CellDoubleClickedEvent) => {
    void runCellPrimaryAction(e.column.getColId(), e.data as GridRowData | undefined);
  }, [runCellPrimaryAction]);

  const onCellKeyDown = useCallback((e: CellKeyDownEvent) => {
    const keyboardEvent = e.event as KeyboardEvent | null;
    if (!keyboardEvent || keyboardEvent.key !== "Enter") {
      return;
    }
    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
    void runCellPrimaryAction(e.column.getColId(), e.data as GridRowData | undefined);
  }, [runCellPrimaryAction]);

  // Apply only newly arrived rows incrementally — no full re-render
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const newRows = rows.slice(appliedCountRef.current);
    if (newRows.length === 0) return;
    api.applyTransaction({ add: newRows.map((r) => mapRow(r)) });
    appliedCountRef.current = rows.length;
  }, [rows, gridColumns]);

  useEffect(() => {
    const stop = () => { isDraggingRef.current = false; };
    document.addEventListener("mouseup", stop);
    return () => document.removeEventListener("mouseup", stop);
  }, []);

  useEffect(() => {
    return () => {
      apiRef.current = null;
      appliedCountRef.current = 0;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.key !== "c") return;
      const api = apiRef.current;
      const model = selectionRef.current;
      if (!api || !model) return;
      const box = getBoundingBox(model, schema.columns.length);
      if (!box) return;
      const rowsByIndex: Array<GridRowData | undefined> = [];
      for (let r = box.rowStart; r <= box.rowEnd; r++) {
        rowsByIndex[r] = api.getDisplayedRowAtIndex(r)?.data as GridRowData | undefined;
      }
      const grid = buildClipboardGridFromRows(rowsByIndex, box, (r, c) => isCellSelected(model, r, c));
      // Drop columns where no row has a selected cell (bounding box may span unselected columns).
      const numCols = box.colIndexEnd - box.colIndexStart + 1;
      const selectedOffsets = Array.from({ length: numCols }, (_, i) => i)
        .filter((ci) => grid.some((row) => row[ci].selected));
      const filteredCols = selectedOffsets.map((ci) => schema.columns[box.colIndexStart + ci]);
      const filteredGrid = grid.map((row) => selectedOffsets.map((ci) => row[ci]));
      if (filteredGrid.length === 0 || filteredCols.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      void writeToClipboard({ grid: filteredGrid, columns: filteredCols });
    };
    el.addEventListener("keydown", handler, true);
    return () => el.removeEventListener("keydown", handler, true);
  }, [schema]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const openContextMenu = (e: MouseEvent) => {
      const model = selectionRef.current;
      const api = apiRef.current;
      if (!model || !api) return;
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, sections: [], loading: true });

      const box = getBoundingBox(model, schema.columns.length);
      if (!box) {
        setContextMenu(null);
        return;
      }
      const rowsByIndex: Array<GridRowData | undefined> = [];
      for (let r = box.rowStart; r <= box.rowEnd; r++) {
        rowsByIndex[r] = api.getDisplayedRowAtIndex(r)?.data as GridRowData | undefined;
      }
      const selection = buildSelectionSnapshot(model, rowsByIndex, schema.columns.length);
      const menuContext: TableOutputContextMenuContext = {
        resultSetIndex,
        columns: schema.columns,
        selection,
      };
      void resolveTableContextMenuItems(getTableOutputContextMenuProviders(), menuContext).then((sections) => {
        if (sections.length === 0) {
          setContextMenu(null);
          return;
        }
        setContextMenu({ x: e.clientX, y: e.clientY, sections, loading: false });
      });
    };

    el.addEventListener("contextmenu", openContextMenu, true);
    return () => el.removeEventListener("contextmenu", openContextMenu, true);
  }, [resultSetIndex, schema.columns]);

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
        rowBuffer={30}
        suppressMovableColumns={false}
      />
      {contextMenu && (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          sections={contextMenu.sections.map((section) => section.map((item) => ({
            id: item.id,
            label: item.label,
            onSelect: item.run,
          })))}
          loading={contextMenu.loading}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function TableOutputView({ context, onPreviewValue }: { context: OutputContext; onPreviewValue: (options: { title: string; value: string; mimeType?: string }) => void }): JSX.Element {
  const tableSettings = resolveOutputTableSettings();
  const isStacked = tableSettings.viewMode === "stacked";
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeStackedResultSetIndex, setActiveStackedResultSetIndex] = useState<number | null>(null);
  const [stackedGridHeightsByResultSet, setStackedGridHeightsByResultSet] = useState<Record<number, number>>({});
  const stackedContainerRef = useRef<HTMLDivElement | null>(null);

  // Restore per-file active tab when the active file changes
  useEffect(() => {
    const saved = context.fileId
      ? (getFileStateRegistry().get(context.fileId, ACTIVE_RESULT_SET_KEY) ?? 0)
      : 0;
    setActiveIndex(saved);
  }, [context.fileId]);

  const clampedIndex = Math.min(activeIndex, Math.max(0, context.resultSets.length - 1));

  useEffect(() => {
    if (clampedIndex !== activeIndex) setActiveIndex(clampedIndex);
  }, [clampedIndex, activeIndex]);

  const handleSetActive = useCallback((i: number) => {
    setActiveIndex(i);
    if (context.fileId) getFileStateRegistry().set(context.fileId, ACTIVE_RESULT_SET_KEY, i);
  }, [context.fileId]);

  useEffect(() => {
    if (!isStacked) {
      setActiveStackedResultSetIndex(null);
      return;
    }
    const container = stackedContainerRef.current;
    if (!container) return;

    const targets = Array.from(container.querySelectorAll<HTMLElement>("[data-result-set-index]"));
    if (targets.length === 0) return;

    const onScroll = () => {
      const containerTop = container.getBoundingClientRect().top;
      let closest: { idx: number; delta: number } | null = null;
      for (const el of targets) {
        const raw = el.getAttribute("data-result-set-index");
        if (!raw) continue;
        const idx = Number(raw);
        if (!Number.isFinite(idx)) continue;
        const delta = Math.abs(el.getBoundingClientRect().top - containerTop - 44);
        if (!closest || delta < closest.delta) {
          closest = { idx, delta };
        }
      }
      if (closest) setActiveStackedResultSetIndex(closest.idx);
    };

    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [isStacked, context.resultSets]);

  const scrollToStackedResultSet = useCallback((resultSetIndex: number) => {
    setActiveStackedResultSetIndex(resultSetIndex);
    const container = stackedContainerRef.current;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(`[data-result-set-index="${resultSetIndex}"]`);
    if (!target) return;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = container.scrollTop + (targetRect.top - containerRect.top) - 6;
    container.scrollTo({ top: Math.max(0, nextTop), behavior: "auto" });
  }, []);

  useEffect(() => {
    setStackedGridHeightsByResultSet((prev) => {
      if (!isStacked || context.resultSets.length <= 1) {
        return Object.keys(prev).length === 0 ? prev : {};
      }
      const activeIndexes = new Set<number>(context.resultSets.map((rs) => rs.resultSetIndex));
      let changed = false;
      const next: Record<number, number> = {};
      for (const [rawKey, value] of Object.entries(prev)) {
        const key = Number(rawKey);
        if (!Number.isFinite(key) || !activeIndexes.has(key)) {
          changed = true;
          continue;
        }
        next[key] = value;
      }
      return changed ? next : prev;
    });
  }, [isStacked, context.resultSets]);

  const startResizeStackedResultSet = useCallback((resultSetIndex: number, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = stackedContainerRef.current;
    if (!container) return;
    const section = container.querySelector<HTMLElement>(`[data-result-set-index="${resultSetIndex}"]`);
    if (!section) return;
    const grid = section.querySelector<HTMLElement>(".table-output-grid-stacked");
    if (!grid) return;

    const startY = event.clientY;
    const startHeight = grid.getBoundingClientRect().height;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientY - startY;
      const nextHeight = Math.max(120, Math.round(startHeight + delta));
      setStackedGridHeightsByResultSet((prev) => ({
        ...prev,
        [resultSetIndex]: nextHeight,
      }));
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.classList.remove("table-output-resizing");
    };

    document.body.classList.add("table-output-resizing");
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, []);

  if (context.resultSets.length === 0) {
    if (context.state === "failed") {
      return <div />;
    }
    if (context.state === "completed") {
      return (
        <div className="table-output-empty">
          No rows returned.
          {context.metrics?.durationMs !== undefined && ` (${context.metrics.durationMs}ms)`}
        </div>
      );
    }
    if (context.state === "cancelled") {
      return <div className="table-output-empty">Query cancelled.</div>;
    }
    if (context.state === "idle") {
      return <div />;
    }
    return <div />;
  }

  const activeSet = context.resultSets[clampedIndex];

  return (
    <div className="table-output-container" tabIndex={-1} data-output-focus-target="true">
      {!isStacked && context.resultSets.length > 1 && (
        <div className="table-output-result-tabs">
          {context.resultSets.map((rs, i) => (
            <button
              key={rs.resultSetIndex}
              className={`table-output-result-tab${i === clampedIndex ? " active" : ""}`}
              onClick={() => handleSetActive(i)}
            >
              Result {rs.resultSetIndex + 1}
            </button>
          ))}
        </div>
      )}

      {isStacked
        ? (
            <>
              {context.resultSets.length > 1 && (
                <div className="table-output-stacked-jumpbar" role="navigation" aria-label="Result set navigation">
                  <span className="table-output-stacked-jumpbar-label">Jump to:</span>
                  {context.resultSets.map((resultSet) => {
                    const isActive = activeStackedResultSetIndex === resultSet.resultSetIndex;
                    return (
                      <button
                        type="button"
                        key={`jump-${resultSet.resultSetIndex}`}
                        className={`table-output-stacked-jump${isActive ? " active" : ""}`}
                        onClick={() => scrollToStackedResultSet(resultSet.resultSetIndex)}
                        aria-current={isActive ? "true" : undefined}
                      >
                        Result {resultSet.resultSetIndex + 1}
                        {resultSet.rowLimitExceeded ? " *" : ""}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="table-output-stacked-list" ref={stackedContainerRef}>
                {context.resultSets.map((resultSet) => (
                  <section key={resultSet.resultSetIndex} className="table-output-stacked-section" data-result-set-index={resultSet.resultSetIndex}>
                    <header className="table-output-stacked-header">Result {resultSet.resultSetIndex + 1}</header>
                    {(() => {
                      const defaultHeight = resolveStackedGridHeightPx(resultSet.rows.length, tableSettings.stackedMaxRows);
                      const resolvedHeight = stackedGridHeightsByResultSet[resultSet.resultSetIndex] ?? defaultHeight;
                      return (
                    <div
                      className="table-output-grid table-output-grid-stacked"
                      style={{
                        height: `${resolvedHeight}px`,
                        maxHeight: `${resolvedHeight}px`
                      }}
                    >
                      <TableGrid
                        resultSetIndex={resultSet.resultSetIndex}
                        schema={resultSet.schema}
                        rows={resultSet.rows}
                        fileId={context.fileId}
                        onPreviewValue={onPreviewValue}
                      />
                    </div>
                      );
                    })()}
                    {resultSet.rowLimitExceeded && (
                      <div className="table-output-limit-banner">
                        Showing {DEFAULT_OUTPUT_LIMITS.maxRows.toLocaleString()} rows — result was truncated.
                        {resultSet.exportPath && (
                          <button
                            className="table-output-limit-open"
                            onClick={() => void window.appShell.openPath(resultSet.exportPath!)}
                          >
                            Open full export
                          </button>
                        )}
                      </div>
                    )}
                    {resultSet.resultSetIndex !== context.resultSets[context.resultSets.length - 1]?.resultSetIndex && (
                      <div
                        className="table-output-stacked-resizer"
                        role="separator"
                        aria-orientation="horizontal"
                        onMouseDown={(event) => startResizeStackedResultSet(resultSet.resultSetIndex, event)}
                      />
                    )}
                  </section>
                ))}
              </div>
            </>
          )
        : (
            <>
              <div className="table-output-grid">
                <TableGrid
                  resultSetIndex={activeSet.resultSetIndex}
                  schema={activeSet.schema}
                  rows={activeSet.rows}
                  fileId={context.fileId}
                  onPreviewValue={onPreviewValue}
                />
              </div>

              {activeSet.rowLimitExceeded && (
                <div className="table-output-limit-banner">
                  Showing {DEFAULT_OUTPUT_LIMITS.maxRows.toLocaleString()} rows — result was truncated.
                  {activeSet.exportPath && (
                    <button
                      className="table-output-limit-open"
                      onClick={() => void window.appShell.openPath(activeSet.exportPath!)}
                    >
                      Open full export
                    </button>
                  )}
                </div>
              )}
            </>
          )}
    </div>
  );
}

function resolveStackedGridHeightPx(rowCount: number, maxVisibleRows: number): number {
  const visibleRows = Math.max(1, Math.min(rowCount, maxVisibleRows));
  return STACKED_GRID_HEADER_HEIGHT_PX + (visibleRows * STACKED_GRID_ROW_HEIGHT_PX) + STACKED_GRID_EXTRA_CHROME_PX;
}

export function createCopyAsCsvTableContextMenuProvider(): TableOutputContextMenuProvider {
  return {
    id: "core.queryengine.output.table.contextMenu.copyAsCsv",
    when: "tableSelection.hasSelection == true",
    async getItems(context) {
      return [
        {
          id: "core.queryengine.output.table.contextMenu.copyAsCsv.item",
          label: "Copy as CSV",
          order: 100,
          when: "tableSelection.isSingleColumnSelection == true",
          run: async () => {
            if (!context.selection.isSingleColumnSelection) {
              return;
            }
            const values = context.selection.selectedCells
              .slice()
              .sort((a, b) => a.rowIndex - b.rowIndex)
              .map((cell) => toCsvScalar(cell.value));
            await navigator.clipboard.writeText(values.join(","));
          }
        }
      ];
    }
  };
}

export const coreQueryEngineOutputTablePlugin: Plugin = {
  manifest: {
    id: "core.queryengine.output.table",
    name: "Query Engine Output: Table",
    version: "0.1.0",
    kind: "core",
    description: "Ag-Grid table output contributor for query results",
    dependencies: ["core.queryengine", "core.settings"],
    requiredCapabilities: ["query.engine"]
  },
  activate: (context) => {
    context.tableOutputContextMenu.registerProvider(createCopyAsCsvTableContextMenuProvider());
    context.settings.registerSettings({
      moduleId: "core.queryengine.output.table",
      title: "Query Output Table",
      order: 120,
      settings: [
        {
          id: OUTPUT_TABLE_VIEW_MODE_SETTING_ID,
          moduleId: "core.queryengine.output.table",
          title: "Result Set Layout",
          description: "Show multiple result sets as tabs or stacked sections.",
          sectionPath: ["Query", "Output", "Table"],
          tags: ["query", "output", "table", "resultset", "layout", "tabs", "stacked"],
          type: "enum",
          defaultValue: "tabs",
          options: [
            { value: "tabs", label: "Tabs" },
            { value: "stacked", label: "Stacked" },
          ],
        },
        {
          id: OUTPUT_TABLE_STACKED_MAX_ROWS_SETTING_ID,
          moduleId: "core.queryengine.output.table",
          title: "Stacked Result Set Max Visible Rows",
          description: "Maximum visible rows (height) per result set when layout is stacked.",
          sectionPath: ["Query", "Output", "Table"],
          tags: ["query", "output", "table", "stacked", "rows", "limit"],
          type: "number",
          defaultValue: 500,
          constraints: { min: 10, max: 1000000 },
        },
      ],
    });

    const settingsService = getCoreSettingsService();
    if (settingsService) {
      settingsService.refreshSchemaFromRegistry();
      void settingsService.syncRegistryModules();
    }
    onCoreSettingsServiceInitialized((service) => {
      service.refreshSchemaFromRegistry();
      void service.syncRegistryModules();
    });

    getOutputRegistry().register({
      id: "core.queryengine.output.table",
      capability: "rows",
      mode: "primary",
      title: "Results",
      icon: outputTableIconUrl,
      priority: 0,
      render: (outputContext) => <TableOutputView context={outputContext} onPreviewValue={(options) => void context.dialog.showValuePreview?.(options)} />
    });
  }
};
