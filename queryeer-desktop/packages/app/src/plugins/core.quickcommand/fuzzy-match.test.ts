import { describe, expect, it } from "vitest";
import { fuzzyScore } from "./fuzzy-match";

describe("fuzzyScore", () => {
  it("returns null when query is not a subsequence of target", () => {
    expect(fuzzyScore("xyz", "hello world")).toBeNull();
    expect(fuzzyScore("abc", "xyz")).toBeNull();
    expect(fuzzyScore("fz", "format")).toBeNull();
  });

  it("returns 0 for empty query (matches everything)", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("", "")).toBe(0);
  });

  it("returns non-null when query is a valid subsequence", () => {
    expect(fuzzyScore("fmt", "format document")).not.toBeNull();
    expect(fuzzyScore("fd", "format document")).not.toBeNull();
    expect(fuzzyScore("f", "format")).not.toBeNull();
  });

  it("scores contiguous match higher than scattered match", () => {
    const contiguous = fuzzyScore("for", "format")!;
    const scattered = fuzzyScore("for", "find on replace")!;
    expect(contiguous).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(contiguous).toBeGreaterThan(scattered);
  });

  it("scores prefix match higher than mid-word match", () => {
    const prefix = fuzzyScore("fo", "format")!;
    const midWord = fuzzyScore("fo", "info output")!;
    expect(prefix).not.toBeNull();
    expect(midWord).not.toBeNull();
    expect(prefix).toBeGreaterThan(midWord);
  });

  it("scores word-boundary match with bonus", () => {
    const boundary = fuzzyScore("fd", "format document")!;
    const nonBoundary = fuzzyScore("fd", "formatted")!;
    expect(boundary).not.toBeNull();
    expect(nonBoundary).not.toBeNull();
    expect(boundary).toBeGreaterThan(nonBoundary);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("FORMAT", "format document")).not.toBeNull();
    expect(fuzzyScore("fmt", "FMT Document")).not.toBeNull();
  });

  it("returns null when target is empty and query is not", () => {
    expect(fuzzyScore("a", "")).toBeNull();
  });
});
