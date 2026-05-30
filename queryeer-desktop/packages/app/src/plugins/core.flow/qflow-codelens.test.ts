import { afterEach, describe, expect, it } from "vitest";
import { parseQflowDocument } from "./qflow-parser";
import { getQflowCodeLens } from "./qflow-codelens";
import {
  clearFlowNodeTypeContributionsForTests,
  registerFlowNodeTypeContribution
} from "./flow-node-type-contributions";

afterEach(() => {
  clearFlowNodeTypeContributionsForTests();
});

describe("qflow CodeLens", () => {
  it("adds core actions and pending status per node", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: load",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n"));

    const lenses = getQflowCodeLens({ document });

    expect(lenses).toHaveLength(1);
    expect(lenses[0]?.lineNumber).toBe(1);
    expect(lenses[0]?.commands.map((command) => command.title)).toEqual([
      "Run Node",
      "Run To Here",
      "Configure",
      "⚪ Pending"
    ]);
    expect(lenses[0]?.commands[0]?.arguments).toEqual(["load"]);
    expect(lenses[0]?.commands[1]?.arguments).toEqual(["load"]);
    expect(lenses[0]?.commands[2]?.arguments).toEqual(["load"]);
  });

  it("uses execution status and contribution summaries", () => {
    registerFlowNodeTypeContribution({
      id: "jdbc.query",
      title: "JDBC Query",
      getSummary: () => [{ label: "Connection", value: "Production" }],
      execute: async () => ({ ok: true, output: { rowsAffected: 1 } })
    });
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: load",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n"));

    const lenses = getQflowCodeLens({
      document,
      execution: {
        mode: { kind: "all" },
        nodes: [{ nodeId: "load", nodeType: "jdbc.query", status: "completed" }],
        ctx: {},
        stoppedOnFailure: false
      }
    });

    expect(lenses[0]?.commands.map((command) => command.title)).toContain("🟢 Passed");
    expect(lenses[0]?.commands.map((command) => command.title)).toContain("Connection: Production");
  });
});
