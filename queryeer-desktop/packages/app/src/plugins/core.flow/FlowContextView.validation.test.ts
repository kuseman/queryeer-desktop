import { describe, expect, it } from "vitest";
import { buildRunIfContextVariables, filterNodeScopedIssues } from "./FlowContextView";
import { parseQflowDocument } from "./qflow-parser";

describe("FlowContextView validation filtering", () => {
  it("keeps core node issues and contribution issues", () => {
    const result = filterNodeScopedIssues([
      { field: "id", message: "Node id is required." },
      { field: "type", message: "Node type is required." },
      { field: "runIf", message: "runIf invalid." },
      { field: "jdbc.connection", message: "Connection is required." },
      { field: "payloadbuilder.catalogs.search.provider", message: "Provider is required." },
      { field: "other.field", message: "Ignore me." }
    ]);

    expect(result).toEqual([
      { field: "id", message: "Node id is required." },
      { field: "type", message: "Node type is required." },
      { field: "runIf", message: "runIf invalid." },
      { field: "jdbc.connection", message: "Connection is required." },
      { field: "payloadbuilder.catalogs.search.provider", message: "Provider is required." }
    ]);
  });
});

describe("FlowContextView runIf context variables", () => {
  it("includes known ctx keys for prior nodes", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: second",
      "type: payloadbuilder.query",
      "runIf: ctx.first.status == 'completed'",
      "%%",
      "select 2"
    ].join("\n"));
    const activeNode = document.nodes[1];

    const variables = buildRunIfContextVariables(document, undefined, activeNode);
    const names = variables.map((variable) => variable.name);

    expect(names).toContain("ctx.first.status");
    expect(names).toContain("ctx.first.nodeType");
    expect(names).toContain("ctx.first.output.rowsAffected");
    expect(names.some((name) => name.startsWith("ctx.second"))).toBe(false);
  });

  it("includes discovered ctx leaf keys from prior node execution output", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: second",
      "type: payloadbuilder.query",
      "runIf: ctx.first.output.customKey == 'ready'",
      "%%",
      "select 2"
    ].join("\n"));
    const activeNode = document.nodes[1];

    const variables = buildRunIfContextVariables(document, {
      mode: { kind: "all" },
      nodes: [],
      ctx: {
        first: {
          output: {
            customKey: "ready",
            nested: {
              flag: true
            },
            "invalid-key": "ignored"
          }
        }
      },
      stoppedOnFailure: false
    }, activeNode);
    const names = variables.map((variable) => variable.name);

    expect(names).toContain("ctx.first.output.customKey");
    expect(names).toContain("ctx.first.output.nested.flag");
    expect(names).not.toContain("ctx.first.output.invalid-key");
  });
});
