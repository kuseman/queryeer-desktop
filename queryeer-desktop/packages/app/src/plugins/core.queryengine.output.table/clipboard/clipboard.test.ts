import { describe, expect, it } from "vitest";
import { plainFormat } from "./formats/plain";
import { htmlFormat } from "./formats/html";
import type { ClipboardCell, ClipboardSelection } from "./ClipboardFormat";
import type { Column } from "@queryeer/api/queryengine/OutputExtension";

const ts: Column = { name: "ts", type: "datetime" };
const msg: Column = { name: "msg", type: "string" };
const level: Column = { name: "level", type: "string" };

function sel(selected: boolean, value: unknown): ClipboardCell {
  return { selected, value };
}

function makeSelection(grid: ClipboardCell[][], columns: Column[]): ClipboardSelection {
  return { grid, columns };
}

// ---------------------------------------------------------------------------
// plainFormat
// ---------------------------------------------------------------------------

describe("plainFormat — single selected cell", () => {
  it("outputs the value", () => {
    const s = makeSelection([[sel(true, "2024-01-01T00:00:00Z")]], [ts]);
    expect(plainFormat.format(s)).toBe("2024-01-01T00:00:00Z");
  });

  it("coerces number to string", () => {
    expect(plainFormat.format(makeSelection([[sel(true, 42)]], [ts]))).toBe("42");
  });

  it("coerces boolean to string", () => {
    expect(plainFormat.format(makeSelection([[sel(true, true)]], [ts]))).toBe("true");
  });

  it("null value outputs empty string", () => {
    expect(plainFormat.format(makeSelection([[sel(true, null)]], [ts]))).toBe("");
  });

  it("undefined value outputs empty string", () => {
    expect(plainFormat.format(makeSelection([[sel(true, undefined)]], [ts]))).toBe("");
  });

  it("unselected cell outputs empty string regardless of value", () => {
    expect(plainFormat.format(makeSelection([[sel(false, "should-not-appear")]], [ts]))).toBe("");
  });
});

describe("plainFormat — multiple columns", () => {
  it("separates columns with tab", () => {
    const s = makeSelection([[sel(true, "2024-01-01"), sel(true, "hello"), sel(true, "INFO")]], [ts, msg, level]);
    expect(plainFormat.format(s)).toBe("2024-01-01\thello\tINFO");
  });

  it("unselected cell in the middle outputs empty tab slot", () => {
    const s = makeSelection([[sel(true, "T"), sel(false, "skip"), sel(true, "L")]], [ts, msg, level]);
    expect(plainFormat.format(s)).toBe("T\t\tL");
  });
});

describe("plainFormat — multiple rows", () => {
  it("separates rows with newline", () => {
    const s = makeSelection(
      [
        [sel(true, "2024-01-01"), sel(true, "a")],
        [sel(true, "2024-01-02"), sel(true, "b")],
      ],
      [ts, msg]
    );
    expect(plainFormat.format(s)).toBe("2024-01-01\ta\n2024-01-02\tb");
  });

  it("sparse selection — fully-unselected rows are omitted", () => {
    const s = makeSelection(
      [
        [sel(true, "T1"), sel(false, ""), sel(false, "")],
        [sel(false, ""), sel(false, ""), sel(false, "")],
        [sel(false, ""), sel(false, ""), sel(true, "L3")],
      ],
      [ts, msg, level]
    );
    expect(plainFormat.format(s)).toBe("T1\t\t\n\t\tL3");
  });
});

// ---------------------------------------------------------------------------
// htmlFormat
// ---------------------------------------------------------------------------

describe("htmlFormat — single column returns null", () => {
  it("returns null for 1-column selection", () => {
    expect(htmlFormat.format(makeSelection([[sel(true, "hello")]], [ts]))).toBeNull();
  });
});

describe("htmlFormat — multi-column", () => {
  it("wraps with table/tbody, header row uses strong, data rows use td", () => {
    const s = makeSelection([[sel(true, "2024-01-01"), sel(true, "hello"), sel(true, "INFO")]], [ts, msg, level]);
    expect(htmlFormat.format(s)).toBe(
      "<table><tbody>" +
      "<tr><td><strong>ts</strong></td><td><strong>msg</strong></td><td><strong>level</strong></td></tr>" +
      "<tr><td>2024-01-01</td><td>hello</td><td>INFO</td></tr>" +
      "</tbody></table>"
    );
  });

  it("unselected cell in row outputs empty td", () => {
    const s = makeSelection([[sel(true, "T"), sel(false, "skip"), sel(true, "L")]], [ts, msg, level]);
    expect(htmlFormat.format(s)).toBe(
      "<table><tbody>" +
      "<tr><td><strong>ts</strong></td><td><strong>msg</strong></td><td><strong>level</strong></td></tr>" +
      "<tr><td>T</td><td></td><td>L</td></tr>" +
      "</tbody></table>"
    );
  });

  it("fully-unselected rows are omitted", () => {
    const s = makeSelection(
      [
        [sel(true, "T1"), sel(false, ""), sel(false, "")],
        [sel(false, ""), sel(false, ""), sel(false, "")],
        [sel(false, ""), sel(false, ""), sel(true, "L3")],
      ],
      [ts, msg, level]
    );
    expect(htmlFormat.format(s)).toBe(
      "<table><tbody>" +
      "<tr><td><strong>ts</strong></td><td><strong>msg</strong></td><td><strong>level</strong></td></tr>" +
      "<tr><td>T1</td><td></td><td></td></tr>" +
      "<tr><td></td><td></td><td>L3</td></tr>" +
      "</tbody></table>"
    );
  });

  it("escapes HTML special characters in values and column names", () => {
    const xss: Column = { name: "<b>col</b>", type: "string" };
    const xss2: Column = { name: "other", type: "string" };
    const s = makeSelection([[sel(true, "<script>alert(1)</script>"), sel(true, "a&b")]], [xss, xss2]);
    expect(htmlFormat.format(s)).toBe(
      "<table><tbody>" +
      "<tr><td><strong>&lt;b&gt;col&lt;/b&gt;</strong></td><td><strong>other</strong></td></tr>" +
      "<tr><td>&lt;script&gt;alert(1)&lt;/script&gt;</td><td>a&amp;b</td></tr>" +
      "</tbody></table>"
    );
  });

  it("null value outputs empty td", () => {
    const s = makeSelection([[sel(true, null), sel(true, "x")]], [ts, msg]);
    expect(htmlFormat.format(s)).toBe(
      "<table><tbody>" +
      "<tr><td><strong>ts</strong></td><td><strong>msg</strong></td></tr>" +
      "<tr><td></td><td>x</td></tr>" +
      "</tbody></table>"
    );
  });
});
