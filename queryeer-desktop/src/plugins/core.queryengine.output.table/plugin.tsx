import { useState, useEffect, useRef, useCallback } from "react";
import type { Plugin } from "../../contracts/plugin/Plugin";
import type { OutputContext, Column } from "../../contracts/extensions/OutputExtension";
import { getOutputRegistry } from "../core.queryengine/output/OutputRegistry";
import { getFileStateRegistry } from "../../core/plugin-runtime/FileStateRegistryImpl";
import { getTableOutputContextMenuProviders } from "../../core/plugin-runtime/ExtensionRegistry";
import { defineStateKey } from "../../contracts/files/FileStateRegistry";
import { writeToClipboard } from "./clipboard/ClipboardRegistry";
import { computeSelection, extendSelection, isCellSelected, getBoundingBox } from "./clipboard/CellSelectionModel";
import type { SelectionAnchor, SelectionModel } from "./clipboard/CellSelectionModel";
import outputTableIconUrl from "./output-table.svg";
import { getCoreSettingsService, onCoreSettingsServiceInitialized } from "../core.settings/service";
import {
  OUTPUT_TABLE_STACKED_MAX_ROWS_SETTING_ID,
  OUTPUT_TABLE_MAX_ROWS_SETTING_ID,
  OUTPUT_TABLE_VIEW_MODE_SETTING_ID,
  resolveOutputTableSettings,
} from "./output-table-settings";
import {
  formatPreviewValue,
  inferPreviewMimeType,
  resolveTableLinkAction,
} from "./table-link-actions";
import { getThemeService } from "../core.themes/runtime";
import { getCommandContext } from "../core.commands/command-context-accessor";
import type {
  TableOutputContextMenuContext,
  TableOutputContextMenuItem,
  TableOutputContextMenuProvider,
  TableOutputSelectionSnapshot,
} from "../../contracts/extensions/TableOutputContextMenuExtension";
import { ContextMenuSurface } from "../../renderer/components/ContextMenuSurface";
import { getExpressionRuntime } from "../core.expressions/runtime";
import { registerWhenExpressionVariables } from "../core.commands/when-expression-variable-registry";
import { TABLE_ACTIONS_SETTING_ID } from "./table-action-types";
import type { TableAction } from "./table-action-types";
import { getTableActionRegistry } from "./table-action-registry";
import { createTableActionProvider } from "./table-action-provider";
import { TableActionsSettingsEditor } from "./table-action-settings";
import { getTableResultStore } from "./table-result-store";
import { GridComponent } from "../../renderer/components/GridComponent";
import type { GridComponentColumn, GridComponentRow, GridComponentSelectionSnapshot, GridComponentState } from "../../renderer/components/GridComponent";

const GRID_STATE_KEY = defineStateKey<Record<number, GridComponentState>>("core.queryengine.output.table.gridState");
const ACTIVE_RESULT_SET_KEY = defineStateKey<number>("core.queryengine.output.table.activeResultSet");

type SavedSelection = { selection: SelectionModel | null; anchor: SelectionAnchor | null };
const SELECTION_KEY = defineStateKey<Record<number, SavedSelection>>("core.queryengine.output.table.selection");

type GridColumn = GridComponentColumn;

type GridRowData = GridComponentRow;

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
  const runtime = getExpressionRuntime();
  const baseContext = getCommandContext();
  const tableContext = {
    tableSelection: {
      hasSelection: context.selection.hasSelection,
      selectedCellCount: context.selection.selectedCells.length,
      selectedRowCount: context.selection.selectedRowIndexes.length,
      selectedColumnCount: context.selection.selectedColumnIndexes.length,
      isSingleColumnSelection: context.selection.isSingleColumnSelection,
      isSingleRowSelection: context.selection.isSingleRowSelection,
      columns: context.columns,
      columnNames: context.columns.map((c) => c.name),
    }
  };
  const mergedContext = { ...baseContext, ...tableContext };

  const sections = await Promise.all(providers.map(async (provider) => {
    try {
      if (
        provider.when
        && !await runtime.evaluateBoolean(provider.when, mergedContext, {
          mode: "when",
          source: `table-context-menu:provider:${provider.id}`,
          timeoutMs: 50,
        })
      ) {
        return [] as TableOutputContextMenuItem[];
      }
      const items = await provider.getItems(context);
      const visibleItems: TableOutputContextMenuItem[] = [];
      for (const item of items) {
        if (!item.when) {
          visibleItems.push(item);
          continue;
        }
        try {
          const visible = await runtime.evaluateBoolean(item.when, mergedContext, {
            mode: "when",
            source: `table-context-menu:item:${provider.id}:${item.id}`,
            timeoutMs: 50,
          });
          if (visible) {
            visibleItems.push(item);
          }
        } catch (error) {
          console.error(`[ExpressionRuntime][table] item '${provider.id}:${item.id}' failed :: ${item.when}`, error);
        }
      }
      return visibleItems.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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

const ROW_NUMBER_COL_WIDTH_PX = 78;
const STACKED_GRID_HEADER_HEIGHT_PX = 26;
const STACKED_GRID_ROW_HEIGHT_PX = 24;
const STACKED_GRID_EXTRA_CHROME_PX = 26;

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
  fileId?: string;
  onPreviewValue: (options: { title: string; value: string; mimeType?: string }) => void;
  isStreaming?: boolean;
};

function TableGrid({ resultSetIndex, schema, fileId, onPreviewValue, isStreaming }: TableGridProps): JSX.Element {
  const storeKey = { fileId, resultSetIndex };
  const gridColumns = toGridColumns(schema.columns);
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

  const getRowsBySelection = useCallback((snapshot: GridComponentSelectionSnapshot): Array<GridRowData | undefined> => snapshot.rowsByIndex, []);

  return (
    <>
      <GridComponent
        key={`${fileId ?? ""}:${resultSetIndex}`}
        columns={gridColumns}
        rowNumberWidth={ROW_NUMBER_COL_WIDTH_PX}
        getRowCount={() => getTableResultStore().getRowCount(storeKey)}
        getRowsRange={(start, end) => getTableResultStore().getRowsRange(storeKey, start, end)}
        getRow={(index) => getTableResultStore().getRow(storeKey, index)}
        subscribeRowsChanged={(listener) => getTableResultStore().subscribe(storeKey, listener)}
        getInitialSelection={() => fileId ? (getFileStateRegistry().get(fileId, SELECTION_KEY)?.[resultSetIndex] ?? { selection: null, anchor: null }) : { selection: null, anchor: null }}
        onSelectionChange={(selection, anchor) => {
          if (!fileId) return;
          const map = getFileStateRegistry().get(fileId, SELECTION_KEY) ?? {};
          getFileStateRegistry().set(fileId, SELECTION_KEY, { ...map, [resultSetIndex]: { selection, anchor } });
        }}
        getInitialGridState={() => fileId ? getFileStateRegistry().get(fileId, GRID_STATE_KEY)?.[resultSetIndex] : undefined}
        onGridStateChange={(state) => {
          if (!fileId) return;
          const map = getFileStateRegistry().get(fileId, GRID_STATE_KEY) ?? {};
          getFileStateRegistry().set(fileId, GRID_STATE_KEY, { ...map, [resultSetIndex]: state });
        }}
        resolveCellDisplayValue={resolveCellDisplayValue}
        resolveCellLink={({ value, columnType }) => resolveTableLinkAction({ value, columnType: columnType as Column["type"] })}
        onCellPrimaryAction={({ value, columnType }) => {
          const action = resolveTableLinkAction({ value, columnType: columnType as Column["type"] });
          if (action) {
            if (action.kind === "external") {
              void window.appShell.openExternal(action.value);
            } else {
              onPreviewValue({ title: action.title, value: action.value, mimeType: action.mimeType });
            }
            return true;
          }

          const mimeType = inferPreviewMimeType(value);
          onPreviewValue({ title: "Value Preview", value: formatPreviewValue(value, mimeType), mimeType });
          return true;
        }}
        onCopySelection={(snapshot) => {
          const model = snapshot.model;
          const box = getBoundingBox(model, schema.columns.length);
          if (!box) return;
          const grid = buildClipboardGridFromRows(getRowsBySelection(snapshot), box, (r, c) => isCellSelected(model, r, c));
          const numCols = box.colIndexEnd - box.colIndexStart + 1;
          const selectedOffsets = Array.from({ length: numCols }, (_, i) => i).filter((ci) => grid.some((row) => row[ci].selected));
          const colOrder = snapshot.colOrder;
          if (colOrder && selectedOffsets.length > 1) {
            selectedOffsets.sort((a, b) => {
              const keyA = gridColumns[box.colIndexStart + a]?.key;
              const keyB = gridColumns[box.colIndexStart + b]?.key;
              if (!keyA || !keyB) return 0;
              return colOrder.indexOf(keyA) - colOrder.indexOf(keyB);
            });
          }
          const filteredCols = selectedOffsets.map((ci) => schema.columns[box.colIndexStart + ci]);
          const filteredGrid = grid.map((row) => selectedOffsets.map((ci) => row[ci]));
          if (filteredGrid.length === 0 || filteredCols.length === 0) return;
          void writeToClipboard({ grid: filteredGrid, columns: filteredCols });
        }}
        onContextMenuSelection={(event, snapshot) => {
          setContextMenu({ x: event.clientX, y: event.clientY, sections: [], loading: true });
          const selection = buildSelectionSnapshot(snapshot.model, getRowsBySelection(snapshot), schema.columns.length);
          const cellValuesByRow: Record<number, unknown[]> = {};
          for (const ri of selection.selectedRowIndexes) {
            const data = snapshot.rowsByIndex[ri];
            if (data?.__values) {
              cellValuesByRow[ri] = data.__values;
            }
          }
          const menuContext: TableOutputContextMenuContext = { resultSetIndex, columns: schema.columns, selection, cellValuesByRow };
          void resolveTableContextMenuItems(getTableOutputContextMenuProviders(), menuContext).then((sections) => {
            if (sections.length === 0) {
              setContextMenu(null);
              return;
            }
            setContextMenu({ x: event.clientX, y: event.clientY, sections, loading: false });
          });
        }}
        isDarkTheme={isDarkTheme}
        isStreaming={isStreaming}
      />
      {contextMenu && (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          sections={contextMenu.sections.map((section) => section.map((item) => ({ id: item.id, label: item.label, onSelect: item.run })))}
          loading={contextMenu.loading}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

function ResultSetMetadata({ metadata }: { metadata?: Record<string, string> }): JSX.Element | null {
  if (!metadata || Object.keys(metadata).length === 0) {
    return null;
  }
  return (
    <div className="result-set-metadata">
      {Object.entries(metadata).map(([key, value]) => (
        <span key={key} className="result-set-metadata-item">
          <span className="result-set-metadata-key">{key}</span>
          <span className="result-set-metadata-value">{value}</span>
        </span>
      ))}
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
                  <section
                    key={resultSet.resultSetIndex}
                    className="table-output-stacked-section"
                    data-result-set-index={resultSet.resultSetIndex}
                    style={context.resultSets.length === 1 ? { flex: 1, minHeight: 0 } : undefined}
                  >
                    <ResultSetMetadata metadata={resultSet.metadata} />
                    {(() => {
                      const isOnlyOne = context.resultSets.length === 1;
                      const defaultHeight = resolveStackedGridHeightPx(resultSet.rowCount ?? resultSet.rows.length, tableSettings.stackedMaxRows);
                      const resolvedHeight = stackedGridHeightsByResultSet[resultSet.resultSetIndex] ?? defaultHeight;
                      return (
                    <div
                      className="table-output-grid table-output-grid-stacked"
                      style={isOnlyOne ? { flex: 1, minHeight: 0 } : { height: `${resolvedHeight}px`, maxHeight: `${resolvedHeight}px` }}
                    >
                      <TableGrid
                        resultSetIndex={resultSet.resultSetIndex}
                        schema={resultSet.schema}
                        fileId={context.fileId}
                        onPreviewValue={onPreviewValue}
                        isStreaming={context.state === "running"}
                      />
                    </div>
                      );
                    })()}
                    {resultSet.rowLimitExceeded && (
                      <div className="table-output-limit-banner">
                        Showing {tableSettings.maxRows.toLocaleString()} rows — result was truncated.
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
              <ResultSetMetadata metadata={activeSet.metadata} />
              <div className="table-output-grid">
                <TableGrid
                  resultSetIndex={activeSet.resultSetIndex}
                  schema={activeSet.schema}
                  fileId={context.fileId}
                  onPreviewValue={onPreviewValue}
                  isStreaming={context.state === "running"}
                />
              </div>

              {activeSet.rowLimitExceeded && (
                <div className="table-output-limit-banner">
                  Showing {tableSettings.maxRows.toLocaleString()} rows — result was truncated.
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
          run: async () => {
            const lines: string[] = [];
            const cellsByRow = new Map<number, TableOutputSelectionSnapshot["selectedCells"]>();
            for (const cell of context.selection.selectedCells) {
              const row = cellsByRow.get(cell.rowIndex) ?? [];
              row.push(cell);
              cellsByRow.set(cell.rowIndex, row);
            }
            for (const [, cells] of [...cellsByRow.entries()].sort(([a], [b]) => a - b)) {
              lines.push(cells
                .slice()
                .sort((a, b) => a.columnIndex - b.columnIndex)
                .map((cell) => toCsvScalar(cell.value))
                .join(","));
            }
            await navigator.clipboard.writeText(lines.join("\n"));
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
    context.tableOutputContextMenu.registerProvider(createTableActionProvider(context));

    // Register when-expression variables for autocomplete in table action editors
    registerWhenExpressionVariables([
      { name: "tableSelection.columns", type: "string", description: "Array<{name, type}> — Columns of the current table selection" },
      { name: "tableSelection.columnNames", type: "string", description: "string[] — Column names of the current table selection" },
      { name: "tableData", type: "string", description: "Full table selection data. Access cell values via tableData.rows[tableData.primaryRowIndex].columnName" },
      { name: "tableData.rows", type: "string", description: "Record<string, unknown>[] — Selected rows keyed by column name. e.g. tableData.rows[0].correlationId" },
      { name: "tableData.columns", type: "string", description: "{name: string, type: string}[] — Column metadata" },
      { name: "tableData.primaryRowIndex", type: "number", description: "Index of the first selected row" },
      { name: "tableData.selectedRowIndexes", type: "string", description: "number[] — All selected row indices" },
      { name: "tableData.selectedColumnIndexes", type: "string", description: "number[] — All selected column indices" },
    ]);

    // Register table actions settings UI
    context.settings.registerAdvancedRenderer({
      id: TABLE_ACTIONS_SETTING_ID,
      render: ({ value, setValue, readonly }) => (
        <TableActionsSettingsEditor value={value} setValue={setValue} readonly={readonly} />
      )
    });
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
          sectionPath: ["Query Engine", "Table", "General"],
          tags: ["query", "output", "table", "resultset", "layout", "tabs", "stacked"],
          type: "enum",
          defaultValue: "tabs",
          options: [
            { value: "tabs", label: "Tabs" },
            { value: "stacked", label: "Stacked" },
          ],
        },
        {
          id: OUTPUT_TABLE_MAX_ROWS_SETTING_ID,
          moduleId: "core.queryengine.output.table",
          title: "Maximum Rows",
          description: "Maximum rows kept in the table before overflow rows are streamed to a temporary export file. Use -1 for no limit.",
          sectionPath: ["Query Engine", "Table", "General"],
          tags: ["query", "output", "table", "rows", "limit", "export"],
          type: "number",
          defaultValue: 100000,
          constraints: { min: -1, max: 10000000 },
        },
        {
          id: OUTPUT_TABLE_STACKED_MAX_ROWS_SETTING_ID,
          moduleId: "core.queryengine.output.table",
          title: "Stacked Result Set Max Visible Rows",
          description: "Maximum visible rows (height) per result set when layout is stacked.",
          sectionPath: ["Query Engine", "Table", "General"],
          tags: ["query", "output", "table", "stacked", "rows", "limit"],
          type: "number",
          defaultValue: 500,
          constraints: { min: 10, max: 1000000 },
        },
        {
          id: TABLE_ACTIONS_SETTING_ID,
          moduleId: "core.queryengine.output.table",
          title: "Table Actions",
          description: "Context menu actions that appear when right-clicking on table cell selections. Actions can execute generated queries or render template results.",
          sectionPath: ["Query Engine", "Table", "Actions"],
          tags: ["query", "table", "actions", "context menu", "template"],
          type: "json",
          defaultValue: [],
          advanced: { rendererId: TABLE_ACTIONS_SETTING_ID }
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

      // Sync table actions from settings to the runtime registry
      service.subscribe(() => {
        const current = service.getValue(TABLE_ACTIONS_SETTING_ID);
        if (Array.isArray(current)) {
          getTableActionRegistry().setActions(current as TableAction[]);
        }
      });
      const initial = service.getValue(TABLE_ACTIONS_SETTING_ID);
      if (Array.isArray(initial)) {
        getTableActionRegistry().setActions(initial as TableAction[]);
      }

      void service.syncRegistryModules();
    });

    getOutputRegistry().register({
      id: "core.queryengine.output.table",
      capability: "rows",
      mode: "primary",
      title: "Results",
      icon: outputTableIconUrl,
      priority: 0,
      onExecutionStart: ({ fileId }) => getTableResultStore().clearFile(fileId),
      onChunkRows: ({ fileId, resultSetIndex, rows }) => getTableResultStore().appendRows({ fileId, resultSetIndex }, rows),
      render: (outputContext) => <TableOutputView context={outputContext} onPreviewValue={(options) => void context.dialog.showValuePreview?.(options)} />
    });
  }
};
