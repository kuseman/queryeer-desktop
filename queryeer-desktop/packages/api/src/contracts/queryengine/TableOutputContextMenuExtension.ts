import type { Column } from "./OutputExtension.js";
import type { Disposable } from "../editor/EditorApi.js";

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
  /** The query file whose results the grid shows. Use it instead of the active file, which can differ with split editors. */
  fileId?: string;
  /** Engine the file is bound to (`engineBinding.engineId`) when the menu opened, if any. */
  engineId?: string;
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
  /** Registers a provider (replacing one with the same id). Disposing removes it unless it was replaced since. */
  registerProvider(provider: TableOutputContextMenuProvider): Disposable;
  unregisterProvider(id: string): void;
};
