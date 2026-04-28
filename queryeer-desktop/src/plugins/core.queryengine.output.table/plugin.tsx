import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi, GridReadyEvent, FirstDataRenderedEvent, StateUpdatedEvent, ICellRendererParams, CellClickedEvent, CellClassParams, CellMouseDownEvent, CellMouseOverEvent } from "ag-grid-community";
import type { GridState } from "ag-grid-community";
import { AllCommunityModule, ModuleRegistry, themeQuartz, colorSchemeDark } from "ag-grid-community";
import type { Plugin } from "../../contracts/plugin/Plugin";
import type { OutputContext, Column } from "../../contracts/extensions/OutputExtension";
import { DEFAULT_OUTPUT_LIMITS } from "../../contracts/extensions/OutputExtension";
import { getOutputRegistry } from "../core.queryengine/output/OutputRegistry";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import { defineStateKey } from "../../contracts/files/FileStateRegistry";
import { writeToClipboard } from "./clipboard/ClipboardRegistry";
import { computeSelection, extendSelection, isCellSelected, isRowSelected, getBoundingBox } from "./clipboard/CellSelectionModel";
import type { SelectionAnchor, SelectionModel } from "./clipboard/CellSelectionModel";
import outputTableIconUrl from "./output-table.svg";

ModuleRegistry.registerModules([AllCommunityModule]);

const compactDarkTheme = themeQuartz.withPart(colorSchemeDark).withParams({
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

function mapRow(row: unknown[], columns: Column[]): Record<string, unknown> {
  return Object.fromEntries(columns.map((col, i) => [col.name, row[i] ?? null]));
}

const ROW_NUMBER_COL_ID = "__rownum__";

function buildColDefs(columns: Column[]): ColDef[] {
  return columns.map((col) => ({
    field: col.name,
    headerName: col.name,
    headerTooltip: col.type,
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 60,
  }));
}

type TableGridProps = {
  resultSetIndex: number;
  schema: { columns: Column[] };
  rows: unknown[][];
  fileId?: string;
};

function TableGrid({ resultSetIndex, schema, rows, fileId }: TableGridProps): JSX.Element {
  const apiRef = useRef<GridApi | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const appliedCountRef = useRef(0);
  const bindingRef = useRef<string>("");

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
    return [rowNumCol, ...buildColDefs(schema.columns)];
  }, [schema]);

  const defaultColDef = useMemo<ColDef>(() => ({
    resizable: true,
    sortable: true,
    filter: true,
    minWidth: 60,
    cellClassRules: {
      "table-cell-selected": (params: CellClassParams) => {
        const model = selectionRef.current;
        if (model == null || params.rowIndex == null) return false;
        const colIdx = schema.columns.findIndex((c) => c.name === params.column.getColId());
        return colIdx !== -1 && isCellSelected(model, params.rowIndex, colIdx);
      },
    },
  }), [schema]);

  const onGridReady = useCallback(
    (params: GridReadyEvent) => {
      apiRef.current = params.api;
      params.api.setGridOption(
        "rowData",
        rowsRef.current.map((r) => mapRow(r, schema.columns))
      );
      appliedCountRef.current = rowsRef.current.length;
    },
    [schema]
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

    api.setGridOption("rowData", rows.map((r) => mapRow(r, schema.columns)));
    appliedCountRef.current = rows.length;

    const savedState = fileId ? getFileStateRegistry().get(fileId, GRID_STATE_KEY) : undefined;
    if (savedState) {
      (api as unknown as { setState?: (state: GridState) => void }).setState?.(savedState);
    }
    api.refreshCells({ force: true });
  }, [fileId, resultSetIndex, rows, schema]);

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
      if (me?.shiftKey || me?.ctrlKey || me?.metaKey) return;
      const colId = e.column.getColId();
      const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : schema.columns.findIndex((c) => c.name === colId);
      const rowIndex = e.node.rowIndex ?? 0;
      isDraggingRef.current = true;
      didDragMoveRef.current = false;
      anchorRef.current = { row: rowIndex, colIndex };
      applySelection(
        { rect: computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, schema.columns.length), cells: [] },
        e.api
      );
    },
    [schema]
  );

  const onCellMouseOver = useCallback(
    (e: CellMouseOverEvent) => {
      if (!isDraggingRef.current || !anchorRef.current) return;
      const colId = e.column.getColId();
      const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : schema.columns.findIndex((c) => c.name === colId);
      const rowIndex = e.node.rowIndex ?? 0;
      didDragMoveRef.current = true;
      applySelection(
        { rect: computeSelection(anchorRef.current, { row: rowIndex, colIndex }, schema.columns.length), cells: [] },
        e.api
      );
    },
    [schema]
  );

  const onCellClicked = useCallback(
    (e: CellClickedEvent) => {
      if (didDragMoveRef.current) {
        didDragMoveRef.current = false;
        return;
      }
      const me = e.event as MouseEvent | null;
      const colId = e.column.getColId();
      const colIndex = colId === ROW_NUMBER_COL_ID ? -1 : schema.columns.findIndex((c) => c.name === colId);
      const rowIndex = e.node.rowIndex ?? 0;
      const totalCols = schema.columns.length;
      const shift = !!me?.shiftKey;
      const ctrl = !!(me?.ctrlKey || me?.metaKey);
      const existing = selectionRef.current;

      let newSel: SelectionModel | null = existing;
      if (shift && ctrl) {
        // Ctrl+Shift: expand the rectangle bounding box to include this cell.
        const prevRect = existing?.rect ?? computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, totalCols);
        newSel = { rect: extendSelection(prevRect, { row: rowIndex, colIndex }, totalCols), cells: existing?.cells ?? [] };
        anchorRef.current = { row: rowIndex, colIndex };
      } else if (shift) {
        // Shift only: extend rectangle from anchor, anchor stays.
        if (anchorRef.current !== null) {
          newSel = { rect: computeSelection(anchorRef.current, { row: rowIndex, colIndex }, totalCols), cells: existing?.cells ?? [] };
        }
      } else if (ctrl) {
        // Ctrl only: add this single cell without expanding any bounding box. Anchor moves here.
        const cells = existing?.cells ?? [];
        const already = cells.some((c) => c.row === rowIndex && c.colIndex === colIndex);
        newSel = { rect: existing?.rect ?? null, cells: already ? cells : [...cells, { row: rowIndex, colIndex }] };
        anchorRef.current = { row: rowIndex, colIndex };
      } else {
        // Plain click: new 1×1 selection, clear everything.
        anchorRef.current = { row: rowIndex, colIndex };
        newSel = { rect: computeSelection({ row: rowIndex, colIndex }, { row: rowIndex, colIndex }, totalCols), cells: [] };
      }

      applySelection(newSel, e.api);
    },
    [schema]
  );

  // Apply only newly arrived rows incrementally — no full re-render
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const newRows = rows.slice(appliedCountRef.current);
    if (newRows.length === 0) return;
    api.applyTransaction({ add: newRows.map((r) => mapRow(r, schema.columns)) });
    appliedCountRef.current = rows.length;
  }, [rows, schema]);

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
      const grid: { value: unknown; selected: boolean }[][] = [];
      for (let r = box.rowStart; r <= box.rowEnd; r++) {
        const rowData = api.getDisplayedRowAtIndex(r)?.data as Record<string, unknown> | undefined;
        const gridRow: { value: unknown; selected: boolean }[] = [];
        for (let c = box.colIndexStart; c <= box.colIndexEnd; c++) {
          const selected = isCellSelected(model, r, c);
          gridRow.push({ value: selected && rowData ? rowData[schema.columns[c].name] : null, selected });
        }
        grid.push(gridRow);
      }
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

  return (
    <div ref={containerRef} style={{ height: "100%", width: "100%" }}>
      <AgGridReact
        theme={compactDarkTheme}
        columnDefs={colDefs}
        defaultColDef={defaultColDef}
        onGridReady={onGridReady}
        onFirstDataRendered={onFirstDataRendered}
        onStateUpdated={onStateUpdated}
        onCellMouseDown={onCellMouseDown}
        onCellMouseOver={onCellMouseOver}
        onCellClicked={onCellClicked}
        rowBuffer={30}
        suppressMovableColumns={false}
      />
    </div>
  );
}

function TableOutputView({ context }: { context: OutputContext }): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);

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
      return <div className="table-output-empty">Press F5 or click Run to execute a query.</div>;
    }
    return <div />;
  }

  const activeSet = context.resultSets[clampedIndex];

  return (
    <div className="table-output-container" tabIndex={-1} data-output-focus-target="true">
      {context.resultSets.length > 1 && (
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

      <div className="table-output-grid">
        <TableGrid
          resultSetIndex={activeSet.resultSetIndex}
          schema={activeSet.schema}
          rows={activeSet.rows}
          fileId={context.fileId}
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
    </div>
  );
}

export const coreQueryEngineOutputTablePlugin: Plugin = {
  manifest: {
    id: "core.queryengine.output.table",
    name: "Query Engine Output: Table",
    version: "0.1.0",
    kind: "core",
    description: "Ag-Grid table output contributor for query results",
    dependencies: ["core.queryengine"],
    requiredCapabilities: ["query.engine"]
  },
  activate: () => {
    getOutputRegistry().register({
      id: "core.queryengine.output.table",
      capability: "rows",
      mode: "primary",
      title: "Results",
      icon: outputTableIconUrl,
      priority: 0,
      render: (context) => <TableOutputView context={context} />
    });
  }
};
