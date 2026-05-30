import { describe, expect, it } from "vitest";
import { buildTableActionData } from "./table-action-provider";
import type { TableOutputContextMenuContext } from "@queryeer/api/queryengine/TableOutputContextMenuExtension";

describe("buildTableActionData", () => {
  it("builds row data from selected cells when cellValuesByRow is not provided", () => {
    const ctx: TableOutputContextMenuContext = {
      resultSetIndex: 0,
      columns: [{ name: "id", type: "string" }, { name: "name", type: "string" }],
      selection: {
        hasSelection: true,
        selectedCells: [
          { rowIndex: 0, columnIndex: 0, value: "abc" },
          { rowIndex: 0, columnIndex: 1, value: "Alice" },
        ],
        selectedRowIndexes: [0],
        selectedColumnIndexes: [0, 1],
        isSingleColumnSelection: false,
        isSingleRowSelection: true,
      },
    };

    const data = buildTableActionData(ctx);

    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].id).toBe("abc");
    expect(data.rows[0].name).toBe("Alice");
    expect(data.primaryRowIndex).toBe(0);
    expect(data.columns).toHaveLength(2);
  });

  it("falls back to selectedCells when cellValuesByRow provides no data for a row", () => {
    const ctx: TableOutputContextMenuContext = {
      resultSetIndex: 0,
      columns: [{ name: "id", type: "string" }],
      selection: {
        hasSelection: true,
        selectedCells: [
          { rowIndex: 0, columnIndex: 0, value: "abc" },
        ],
        selectedRowIndexes: [0],
        selectedColumnIndexes: [0],
        isSingleColumnSelection: true,
        isSingleRowSelection: true,
      },
      cellValuesByRow: {},
    };

    const data = buildTableActionData(ctx);

    expect(data.rows).toHaveLength(1);
    expect(data.rows[0].id).toBe("abc");
  });

  it("uses cellValuesByRow to populate all columns when available", () => {
    const ctx: TableOutputContextMenuContext = {
      resultSetIndex: 0,
      columns: [{ name: "id", type: "string" }, { name: "name", type: "string" }, { name: "value", type: "int" }],
      selection: {
        hasSelection: true,
        selectedCells: [
          { rowIndex: 0, columnIndex: 0, value: "abc" },
        ],
        selectedRowIndexes: [0],
        selectedColumnIndexes: [0],
        isSingleColumnSelection: true,
        isSingleRowSelection: true,
      },
      cellValuesByRow: {
        0: ["abc", "Alice", 42],
      },
    };

    const data = buildTableActionData(ctx);

    expect(data.rows).toHaveLength(1);
    // All columns should be populated, not just the selected one
    expect(data.rows[0].id).toBe("abc");
    expect(data.rows[0].name).toBe("Alice");
    expect(data.rows[0].value).toBe(42);
  });

  it("returns empty rows when no columns are provided", () => {
    const ctx: TableOutputContextMenuContext = {
      resultSetIndex: 0,
      columns: [],
      selection: {
        hasSelection: true,
        selectedCells: [],
        selectedRowIndexes: [0],
        selectedColumnIndexes: [],
        isSingleColumnSelection: false,
        isSingleRowSelection: true,
      },
    };

    const data = buildTableActionData(ctx);

    expect(data.rows).toHaveLength(1);
    expect(Object.keys(data.rows[0])).toHaveLength(0);
  });

  it("handles multiple selected rows", () => {
    const ctx: TableOutputContextMenuContext = {
      resultSetIndex: 0,
      columns: [{ name: "id", type: "string" }, { name: "name", type: "string" }],
      selection: {
        hasSelection: true,
        selectedCells: [
          { rowIndex: 0, columnIndex: 0, value: "a1" },
          { rowIndex: 0, columnIndex: 1, value: "Alice" },
          { rowIndex: 1, columnIndex: 0, value: "b2" },
          { rowIndex: 1, columnIndex: 1, value: "Bob" },
        ],
        selectedRowIndexes: [0, 1],
        selectedColumnIndexes: [0, 1],
        isSingleColumnSelection: false,
        isSingleRowSelection: false,
      },
    };

    const data = buildTableActionData(ctx);

    expect(data.rows).toHaveLength(2);
    expect(data.rows[0].id).toBe("a1");
    expect(data.rows[0].name).toBe("Alice");
    expect(data.rows[1].id).toBe("b2");
    expect(data.rows[1].name).toBe("Bob");
  });
});
