import type { TableOutputContextMenuContext } from "@queryeer/api/queryengine/TableOutputContextMenuExtension";

export type TableSelectionWhenContext = {
  hasSelection: boolean;
  selectedCellCount: number;
  selectedRowCount: number;
  selectedColumnCount: number;
  isSingleColumnSelection: boolean;
  isSingleRowSelection: boolean;
  columns: TableOutputContextMenuContext["columns"];
  columnNames: string[];
  /** The grid's file. Prefer it over `activeFile`, which can be another file with split editors. */
  fileId: string | undefined;
  /** Engine the grid's file is bound to, if any. */
  engineId: string | undefined;
};

/** The `tableSelection` variable that table context menu `when` expressions evaluate against. */
export function buildTableSelectionWhenContext(context: TableOutputContextMenuContext): TableSelectionWhenContext {
  return {
    hasSelection: context.selection.hasSelection,
    selectedCellCount: context.selection.selectedCells.length,
    selectedRowCount: context.selection.selectedRowIndexes.length,
    selectedColumnCount: context.selection.selectedColumnIndexes.length,
    isSingleColumnSelection: context.selection.isSingleColumnSelection,
    isSingleRowSelection: context.selection.isSingleRowSelection,
    columns: context.columns,
    columnNames: context.columns.map((c) => c.name),
    fileId: context.fileId,
    engineId: context.engineId
  };
}
