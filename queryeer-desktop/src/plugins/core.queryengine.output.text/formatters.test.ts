import { describe, expect, it } from "vitest";
import type { OutputContext } from "../../contracts/extensions/OutputExtension";
import { resolveTextOutputFormatter } from "./formatters";

function makeContext(overrides: Partial<OutputContext>): OutputContext {
  return {
    state: "completed",
    resultSets: [],
    features: ["rows"],
    metrics: null,
    error: null,
    progress: null,
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
    expect(lines).toContain("[FAILED]");
    expect(lines).toContain("Something broke");
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
    expect(lines).toEqual(["[FAILED]", "Rich backend failure details"]);
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
        ]
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
        ]
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
    expect(lines).toEqual([]);
  });
});
