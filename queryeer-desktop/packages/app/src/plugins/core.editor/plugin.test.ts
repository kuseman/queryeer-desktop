import { describe, expect, it } from "vitest";
import { documentRangeFromText, normalizeToolText, sameToolText } from "./plugin";

describe("core editor assistant tools", () => {
  it("normalizes line endings before comparing expected text", () => {
    expect(normalizeToolText("a\r\nb\rc")).toBe("a\nb\nc");
  });

  it("compares tool text independent of line ending style", () => {
    expect(sameToolText("a\r\nb", "a\nb")).toBe(true);
    expect(sameToolText("a\r\nb", "a\nc")).toBe(false);
  });

  it("calculates a full-document range without counting line endings as columns", () => {
    expect(documentRangeFromText("one\r\ntwo\r\n")).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 3,
      endColumn: 1
    });
    expect(documentRangeFromText("one\ntwo")).toEqual({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 2,
      endColumn: 4
    });
  });
});
