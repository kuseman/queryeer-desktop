import { describe, expect, it } from "vitest";
import { buildClipboardGridFromRows, getCellValueForCopy, resolveCellDisplayValue, resolveFilterType } from "./plugin";

describe("table output column type filters", () => {
  it("maps numeric canonical types to number filter", () => {
    expect(resolveFilterType("int")).toBe("agNumberColumnFilter");
    expect(resolveFilterType("long")).toBe("agNumberColumnFilter");
    expect(resolveFilterType("decimal")).toBe("agNumberColumnFilter");
    expect(resolveFilterType("float")).toBe("agNumberColumnFilter");
    expect(resolveFilterType("double")).toBe("agNumberColumnFilter");
  });

  it("maps datetime canonical types to date filter", () => {
    expect(resolveFilterType("datetime")).toBe("agDateColumnFilter");
    expect(resolveFilterType("datetimeoffset")).toBe("agDateColumnFilter");
  });

  it("maps boolean to set filter", () => {
    expect(resolveFilterType("boolean")).toBe("agSetColumnFilter");
  });

  it("falls back to text filter for non-optimized types", () => {
    expect(resolveFilterType("string")).toBe("agTextColumnFilter");
    expect(resolveFilterType("object")).toBe("agTextColumnFilter");
    expect(resolveFilterType("array")).toBe("agTextColumnFilter");
    expect(resolveFilterType("table")).toBe("agTextColumnFilter");
    expect(resolveFilterType("any")).toBe("agTextColumnFilter");
    expect(resolveFilterType("null")).toBe("agTextColumnFilter");
  });
});

describe("table output value formatting", () => {
  it("formats decimal as visible string", () => {
    expect(resolveCellDisplayValue("decimal", 10.1)).toBe("10.1");
    expect(resolveCellDisplayValue("decimal", "10.100000")).toBe("10.100000");
  });

  it("formats datetime values as strings", () => {
    expect(resolveCellDisplayValue("datetime", "2026-04-29T14:43:00.260")).toBe("2026-04-29T14:43:00.260");
    expect(resolveCellDisplayValue("datetimeoffset", "2026-04-29T12:43:00.260Z[UTC]")).toBe("2026-04-29T12:43:00.260Z[UTC]");
  });
});

describe("table output copy value extraction", () => {
  it("reads value from indexed __values row storage", () => {
    expect(getCellValueForCopy({ __values: ["a", "b", "10.100000"] }, 2)).toBe("10.100000");
  });

  it("returns null for missing row data", () => {
    expect(getCellValueForCopy(undefined, 0)).toBeNull();
  });

  it("builds clipboard grid from indexed row values", () => {
    const grid = buildClipboardGridFromRows(
      [
        { __values: ["2026-04-29T14:43:00.260", "2026-04-29T12:43:00.260Z[UTC]", "10.100000"] }
      ],
      { rowStart: 0, rowEnd: 0, colIndexStart: 0, colIndexEnd: 2 },
      () => true
    );
    expect(grid[0][2].value).toBe("10.100000");
  });
});
