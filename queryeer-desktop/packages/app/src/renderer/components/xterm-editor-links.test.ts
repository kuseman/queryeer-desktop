import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { findEditorLinks } from "./xterm-editor-links";

function writeLines(cols: number, lines: string[]): Promise<Terminal> {
  const terminal = new Terminal({ cols, rows: 10, convertEol: true });
  return new Promise((resolve) => {
    terminal.write(lines.join("\n") + "\n", () => resolve(terminal));
  });
}

const ERROR_LINE = "\u001b[31mError: Invalid column name 'foo'. ([line 59, col 1])\u001b[0m";

describe("findEditorLinks", () => {
  it("finds a location label on a single row", async () => {
    const terminal = await writeLines(120, [ERROR_LINE]);

    const links = findEditorLinks(terminal.buffer.active, 1);

    expect(links).toEqual([
      {
        range: { start: { x: 36, y: 1 }, end: { x: 51, y: 1 } },
        text: "[line 59, col 1]",
        uri: "editor://open?line=59&column=1"
      }
    ]);
  });

  it("finds a location label split over soft-wrapped rows from either row", async () => {
    // 45 columns wraps the label as "...([line 59, " + "col 1])"
    const terminal = await writeLines(45, [ERROR_LINE]);

    const fromFirstRow = findEditorLinks(terminal.buffer.active, 1);
    const fromSecondRow = findEditorLinks(terminal.buffer.active, 2);

    const expected = {
      range: { start: { x: 36, y: 1 }, end: { x: 6, y: 2 } },
      text: "[line 59, col 1]",
      uri: "editor://open?line=59&column=1"
    };
    expect(fromFirstRow).toEqual([expected]);
    expect(fromSecondRow).toEqual([expected]);
  });

  it("only returns links that touch the requested row", async () => {
    const terminal = await writeLines(120, ["first ([line 1, col 2])", "second ([line 3, col 4])"]);

    expect(findEditorLinks(terminal.buffer.active, 2).map((link) => link.uri)).toEqual([
      "editor://open?line=3&column=4"
    ]);
  });

  it("finds direct editor:// uris and ignores labels with invalid positions", async () => {
    const terminal = await writeLines(120, ["see editor://open?line=2&column=3) and [line 0, col 1]"]);

    expect(findEditorLinks(terminal.buffer.active, 1)).toEqual([
      {
        range: { start: { x: 5, y: 1 }, end: { x: 33, y: 1 } },
        text: "editor://open?line=2&column=3",
        uri: "editor://open?line=2&column=3"
      }
    ]);
  });
});
