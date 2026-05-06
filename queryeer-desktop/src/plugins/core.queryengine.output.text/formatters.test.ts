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
    ...overrides
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
});
