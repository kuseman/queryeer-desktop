import { describe, expect, it } from "vitest";
import type { OutputContext } from "../../contracts/extensions/OutputExtension";
import { resolveTextOutputFormatter } from "./formatters";

function makeContext(overrides: Partial<OutputContext>): OutputContext {
  return {
    state: "completed",
    resultSets: [],
    output: [],
    features: ["rows"],
    metrics: null,
    error: null,
    progress: null,
    fetchedRowCount: 0,
    executionStartedAtMs: null,
    textOutputFormat: "plain",
    rowsTargetPrimaryId: null,
    ...overrides,
    artifacts: overrides.artifacts ?? []
  };
}

describe("text output formatters", () => {
  it("formats failed output in plain formatter", () => {
    const formatter = resolveTextOutputFormatter("plain");
    const lines = formatter.format(
      makeContext({
        state: "failed",
        error: { code: "FAILED", message: "Something broke" }
      })
    );
    expect(lines).toEqual(["\x1b[31mSomething broke\x1b[0m"]);
  });

  it("shows failed message even when rows were streamed before failure", () => {
    const formatter = resolveTextOutputFormatter("plain");
    const lines = formatter.format(
      makeContext({
        state: "failed",
        resultSets: [
          {
            resultSetIndex: 0,
            schema: { columns: [{ name: "id", type: "int" }] },
            rows: [[1]],
            rowLimitExceeded: false
          }
        ],
        error: { code: "FAILED", message: "Rich backend failure details" }
      })
    );
    expect(lines).toEqual(["\x1b[31mRich backend failure details\x1b[0m"]);
  });

  it("includes editor link for failed errors with line details", () => {
    const formatter = resolveTextOutputFormatter("plain");
    const lines = formatter.format(
      makeContext({
        state: "failed",
        fileId: "file-1",
        error: { code: "FAILED", message: "Parse failed", details: { line: 4, column: 2 } }
      })
    );
    expect(lines[0]).toContain("[line 4, col 2]");
    expect(lines[0]).not.toContain("editor://open?");
  });

  it("formats rows in json formatter", () => {
    const formatter = resolveTextOutputFormatter("json");
    const lines = formatter.format(
      makeContext({
        resultSets: [
          {
            resultSetIndex: 0,
            schema: { columns: [{ name: "id", type: "int" }] },
            rows: [[1]],
            rowLimitExceeded: false
          }
        ],
        rowsTargetPrimaryId: "core.queryengine.output.text"
      })
    );
    expect(lines.join("\n")).toContain('"id": 1');
  });

  it("formats rows in csv formatter", () => {
    const formatter = resolveTextOutputFormatter("csv");
    const lines = formatter.format(
      makeContext({
        resultSets: [
          {
            resultSetIndex: 0,
            schema: { columns: [{ name: "name", type: "string" }] },
            rows: [["alice"]],
            rowLimitExceeded: false
          }
        ],
        rowsTargetPrimaryId: "core.queryengine.output.text"
      })
    );
    expect(lines).toContain('"name"');
    expect(lines).toContain('"alice"');
  });

  it("shows no text when rows exist but result sets are hidden", () => {
    const formatter = resolveTextOutputFormatter("plain");
    const lines = formatter.format(
      makeContext({
        state: "completed",
        resultSets: [],
        metrics: { rowCount: 3 }
      })
    );
    expect(lines).toContain("Rows fetched: 3");
  });

  it("keeps status text plain while formatting only row payload", () => {
    const formatter = resolveTextOutputFormatter("json");
    const lines = formatter.format(
      makeContext({
        state: "running",
        progress: { message: "Running query..." },
        fetchedRowCount: 2,
        rowsTargetPrimaryId: "core.queryengine.output.text",
        resultSets: [
          {
            resultSetIndex: 0,
            schema: { columns: [{ name: "id", type: "int" }] },
            rows: [[1], [2]],
            rowLimitExceeded: false
          }
        ]
      })
    );

    expect(lines[0]).toBe("Running query...");
    expect(lines[1]).toBe("Rows fetched: 2");
    expect(lines.join("\n")).toContain('"id": 1');
  });

  it("does not prepend idle hint when rows already exist", () => {
    const formatter = resolveTextOutputFormatter("plain");
    const lines = formatter.format(
      makeContext({
        state: "idle",
        rowsTargetPrimaryId: "core.queryengine.output.text",
        resultSets: [
          {
            resultSetIndex: 0,
            schema: { columns: [{ name: "id", type: "int" }] },
            rows: [[1]],
            rowLimitExceeded: false
          }
        ]
      })
    );

    expect(lines[0]).toBe("Result set 1");
    expect(lines).not.toContain("Press F5 or click Run to execute a query.");
  });

  it("does not show idle hint when no rows exist", () => {
    const formatter = resolveTextOutputFormatter("plain");
    const lines = formatter.format(
      makeContext({
        state: "idle",
        resultSets: []
      })
    );

    expect(lines).toEqual([]);
  });

  describe("formatFile", () => {
    const resultSets = [
      {
        resultSetIndex: 0,
        schema: { columns: [{ name: "name", type: "string" as const }, { name: "age", type: "int" as const }] },
        rows: [["alice", 30], ["bob", 25]],
        rowLimitExceeded: false
      }
    ];

    it("csv formatFile produces CSV content without trailing blank lines", () => {
      const formatter = resolveTextOutputFormatter("csv");
      const content = formatter.formatFile(resultSets);
      expect(content).toBe('"name","age"\n"alice","30"\n"bob","25"');
    });

    it("json formatFile produces JSON content", () => {
      const formatter = resolveTextOutputFormatter("json");
      const content = formatter.formatFile(resultSets);
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].rows).toEqual([
        { name: "alice", age: 30 },
        { name: "bob", age: 25 }
      ]);
    });

    it("plain formatFile produces plain text content", () => {
      const formatter = resolveTextOutputFormatter("plain");
      const content = formatter.formatFile(resultSets);
      expect(content).toContain("Result set 1");
      expect(content).toContain("name | age");
      expect(content).toContain("alice | 30");
      expect(content).toContain("bob | 25");
    });
  });
});
