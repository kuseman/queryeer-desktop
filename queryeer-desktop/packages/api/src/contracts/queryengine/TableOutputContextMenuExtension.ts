import type { Column } from "./OutputExtension.js";

export type TableOutputSelectedCell = {
  rowIndex: number;
  columnIndex: number;
  value: unknown;
};

export type TableOutputSelectionSnapshot = {
  hasSelection: boolean;
  selectedCells: TableOutputSelectedCell[];
  selectedRowIndexes: number[];
  selectedColumnIndexes: number[];
  isSingleColumnSelection: boolean;
  isSingleRowSelection: boolean;
};

export type TableOutputContextMenuContext = {
  resultSetIndex: number;
  columns: Column[];
  selection: TableOutputSelectionSnapshot;
  /** Full cell values keyed by row index for all columns on rows that intersect the selection. Populated by the table grid. */
  cellValuesByRow?: Record<number, unknown[]>;
};

export type TableOutputContextMenuItem = {
  id: string;
  label: string;
  order?: number;
  when?: string;
  run(): void | Promise<void>;
};

export type TableOutputContextMenuProvider = {
  id: string;
  when?: string;
  getItems(context: TableOutputContextMenuContext): Promise<TableOutputContextMenuItem[]>;
};

export type TableOutputContextMenuRegistry = {
  registerProvider(provider: TableOutputContextMenuProvider): void;
  unregisterProvider(id: string): void;
};
