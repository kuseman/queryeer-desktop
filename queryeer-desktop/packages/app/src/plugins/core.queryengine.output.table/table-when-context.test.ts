import { describe, expect, it } from "vitest";
import type { TableOutputContextMenuContext } from "@queryeer/api/queryengine/TableOutputContextMenuExtension";
import { buildTableSelectionWhenContext } from "./table-when-context";

function makeContext(overrides: Partial<TableOutputContextMenuContext> = {}): TableOutputContextMenuContext {
  return {
    resultSetIndex: 0,
    columns: [{ name: "id", type: "string" }, { name: "name", type: "string" }],
    selection: {
      hasSelection: true,
      selectedCells: [{ rowIndex: 0, columnIndex: 1, value: "Alice" }],
      selectedRowIndexes: [0],
      selectedColumnIndexes: [1],
      isSingleColumnSelection: true,
      isSingleRowSelection: true
    },
    ...overrides
  };
}

describe("buildTableSelectionWhenContext", () => {
  it("exposes the selection, the grid's file and its engine", () => {
    expect(buildTableSelectionWhenContext(makeContext({ fileId: "file-1", engineId: "mongodb" }))).toEqual({
      hasSelection: true,
      selectedCellCount: 1,
      selectedRowCount: 1,
      selectedColumnCount: 1,
      isSingleColumnSelection: true,
      isSingleRowSelection: true,
      columns: [{ name: "id", type: "string" }, { name: "name", type: "string" }],
      columnNames: ["id", "name"],
      fileId: "file-1",
      engineId: "mongodb"
    });
  });
});
