import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeFlowDocument } from "./qflow-executor";
import {
  clearFlowNodeTypeContributionsForTests,
  registerFlowNodeTypeContribution
} from "./flow-node-type-contributions";
import { parseQflowDocument } from "./qflow-parser";

const originalAppShell = window.appShell;

beforeEach(() => {
  window.appShell = {
    ...window.appShell,
    evaluateExpression: async (params) => {
      const keys = Object.keys(params.context);
      const values = keys.map((key) => params.context[key]);
      const fnObj = materializeFunctions(params.functions) as Record<string, unknown>;
      const runner = new Function(...keys, "fn", `return (${params.expression});`) as (...args: unknown[]) => unknown;
      return runner(...values, fnObj);
    },
    evaluateExpressionSync: (params) => {
      try {
        const keys = Object.keys(params.context);
        const values = keys.map((key) => params.context[key]);
        const fnObj = materializeFunctions(params.functions) as Record<string, unknown>;
        const runner = new Function(...keys, "fn", `return (${params.expression});`) as (...args: unknown[]) => unknown;
        return { ok: true as const, result: runner(...values, fnObj) };
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
});

afterEach(() => {
  clearFlowNodeTypeContributionsForTests();
  window.appShell = originalAppShell;
});

describe("qflow executor", () => {
  it("runs all nodes and produces ctx outputs", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: n1",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: n2",
      "type: payloadbuilder.query",
      "runIf: ctx.n1.output.rowsAffected > 0",
      "%%",
      "select 2"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "all" });

    expect(result.stoppedOnFailure).toBe(false);
    expect(result.failedNodeId).toBeUndefined();
    expect(result.nodes.map((node) => node.status)).toEqual(["completed", "completed"]);
    expect(Object.keys(result.ctx)).toEqual(["n1", "n2"]);
  });

  it("marks node skipped when runIf is false", async () => {
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
      "runIf: false",
      "%%",
      "select 2"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "all" });

    expect(result.nodes[0]?.status).toBe("completed");
    expect(result.nodes[1]?.status).toBe("skipped");
    expect(result.nodes[1]?.skipReason).toBe("runIfFalse");
    expect(result.ctx.second).toBeUndefined();
  });

  it("fails node when runIf references unknown symbol", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "runIf: unknownSymbol > 0",
      "%%",
      "select 1"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "all" });

    expect(result.stoppedOnFailure).toBe(true);
    expect(result.failedNodeId).toBe("first");
    expect(result.nodes[0]?.status).toBe("failed");
    expect(result.nodes[0]?.error?.code).toBe("RUN_IF_EVALUATION_ERROR");
  });

  it("renders action template expressions with ctx values", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: bootstrap",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: templated",
      "type: payloadbuilder.query",
      "runIf: ctx.bootstrap.output.rowsAffected > 0",
      "%%",
      "select ${ctx.bootstrap.output.rowsAffected} as rows"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "all" });

    expect(result.nodes[0]?.status).toBe("completed");
    expect(result.nodes[1]?.status).toBe("completed");
    expect(result.nodes[1]?.output?.preview).toContain("select 1 as rows");
  });

  it("uses an injected node runner with rendered action text", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: bootstrap",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: custom",
      "type: payloadbuilder.query",
      "%%",
      "select ${ctx.bootstrap.output.rowsAffected} as rows"
    ].join("\n"));
    const seenActions: string[] = [];

    const result = await executeFlowDocument(document, { kind: "all" }, {
      nodeRunner: async ({ action, node }) => {
        seenActions.push(action);
        return {
          ok: true,
          output: {
            rowsAffected: node.metadata.id === "bootstrap" ? 3 : 1,
            preview: action
          }
        };
      }
    });

    expect(result.nodes.map((node) => node.status)).toEqual(["completed", "completed"]);
    expect(seenActions).toEqual(["select 1", "select 3 as rows"]);
    expect(result.ctx.custom).toMatchObject({
      output: {
        rowsAffected: 1,
        preview: "select 3 as rows"
      }
    });
  });

  it("routes default execution through a node type contribution", async () => {
    registerFlowNodeTypeContribution({
      id: "custom.query",
      title: "Custom Query",
      execute: async ({ action, node }) => ({
        ok: true,
        output: {
          rowsAffected: 7,
          preview: `${node.metadata.type}: ${action}`
        }
      })
    });
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: custom",
      "type: custom.query",
      "%%",
      "select 1"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "all" });

    expect(result.nodes[0]?.status).toBe("completed");
    expect(result.nodes[0]?.output).toMatchObject({
      rowsAffected: 7,
      preview: "custom.query: select 1"
    });
  });

  it("reports running progress before awaiting node runner completion", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: slow",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n"));
    const progressStatuses: string[][] = [];

    await executeFlowDocument(document, { kind: "all" }, {
      onProgress: (progress) => {
        progressStatuses.push(progress.nodes.map((node) => node.status));
      },
      nodeRunner: async () => {
        await Promise.resolve();
        return {
          ok: true,
          output: {
            rowsAffected: 1,
            preview: "select 1"
          }
        };
      }
    });

    expect(progressStatuses).toEqual([["running"]]);
  });

  it("uses injected node runner failure code when provided", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: fails",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "all" }, {
      nodeRunner: async () => ({
        ok: false,
        code: "QUERY_ENGINE_FAILED",
        message: "Backend query failed"
      })
    });

    expect(result.failedNodeId).toBe("fails");
    expect(result.nodes[0]?.status).toBe("failed");
    expect(result.nodes[0]?.error).toEqual({
      code: "QUERY_ENGINE_FAILED",
      message: "Backend query failed"
    });
  });

  it("fails node when action template evaluation fails", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: broken",
      "type: payloadbuilder.query",
      "%%",
      "select ${unknownSymbol}"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "all" });

    expect(result.stoppedOnFailure).toBe(true);
    expect(result.failedNodeId).toBe("broken");
    expect(result.nodes[0]?.status).toBe("failed");
    expect(result.nodes[0]?.error?.code).toBe("NODE_EXECUTION_FAILED");
    expect(result.nodes[0]?.error?.message).toContain("action template failed");
  });

  it("stops on first failure and blocks following nodes", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: ok",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: fails",
      "type: payloadbuilder.query",
      "%%",
      "flow.fail",
      "",
      "%%queryeer-flow",
      "id: never",
      "type: jdbc.query",
      "%%",
      "select 3"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "all" });

    expect(result.stoppedOnFailure).toBe(true);
    expect(result.failedNodeId).toBe("fails");
    expect(result.nodes.map((node) => node.status)).toEqual(["completed", "failed", "skipped"]);
    expect(result.nodes[2]?.skipReason).toBe("blockedByFailure");
  });

  it("run to node obeys stop-on-failure semantics", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: start",
      "type: payloadbuilder.query",
      "%%",
      "flow.fail",
      "",
      "%%queryeer-flow",
      "id: target",
      "type: jdbc.query",
      "%%",
      "select 2",
      "",
      "%%queryeer-flow",
      "id: tail",
      "type: payloadbuilder.query",
      "%%",
      "select 3"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "to-node", nodeId: "target" });

    expect(result.mode).toEqual({ kind: "to-node", nodeId: "target" });
    expect(result.failedNodeId).toBe("start");
    expect(result.nodes[0]?.status).toBe("failed");
    expect(result.nodes[1]?.status).toBe("skipped");
    expect(result.nodes[1]?.skipReason).toBe("blockedByFailure");
    expect(result.nodes[2]?.status).toBe("pending");
    expect(result.nodes[2]?.skipReason).toBeUndefined();
  });

  it("run-to-node keeps nodes after target as not-run (pending)", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: a",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: b",
      "type: payloadbuilder.query",
      "%%",
      "select 2",
      "",
      "%%queryeer-flow",
      "id: c",
      "type: jdbc.query",
      "%%",
      "select 3"
    ].join("\n"));

    const result = await executeFlowDocument(document, { kind: "to-node", nodeId: "b" });

    expect(result.nodes.map((node) => node.status)).toEqual(["completed", "completed", "pending"]);
  });

  it("node-only run reuses prior state and does not mark downstream skipped", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: payloadbuilder.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: second",
      "type: jdbc.query",
      "%%",
      "select 2",
      "",
      "%%queryeer-flow",
      "id: third",
      "type: payloadbuilder.query",
      "%%",
      "select 3"
    ].join("\n"));

    const firstPass = await executeFlowDocument(document, { kind: "all" });
    const result = await executeFlowDocument(
      document,
      { kind: "node-only", nodeId: "second" },
      { previousExecution: firstPass }
    );

    expect(result.nodes.map((node) => node.status)).toEqual(["completed", "completed", "completed"]);
    expect(result.ctx.first).toBeTruthy();
    expect(result.ctx.second).toBeTruthy();
    expect(result.ctx.third).toBeTruthy();
  });

  it("continue from node runs remaining nodes with existing ctx", async () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: bootstrap",
      "type: jdbc.query",
      "%%",
      "select 1",
      "",
      "%%queryeer-flow",
      "id: middle",
      "type: payloadbuilder.query",
      "%%",
      "select 2",
      "",
      "%%queryeer-flow",
      "id: tail",
      "type: jdbc.query",
      "runIf: ctx.middle.output.rowsAffected > 0",
      "%%",
      "select 3"
    ].join("\n"));

    const toMiddle = await executeFlowDocument(document, { kind: "to-node", nodeId: "middle" });
    expect(toMiddle.nodes.map((node) => node.status)).toEqual(["completed", "completed", "pending"]);

    const continued = await executeFlowDocument(
      document,
      { kind: "from-node", nodeId: "tail" },
      { previousExecution: toMiddle }
    );

    expect(continued.nodes.map((node) => node.status)).toEqual(["completed", "completed", "completed"]);
    expect(Object.keys(continued.ctx)).toEqual(["bootstrap", "middle", "tail"]);
  });
});

function materializeFunctions(value: unknown): unknown {
  if (typeof value === "string") {
    return new Function(`return (${value});`)();
  }
  if (Array.isArray(value)) {
    return value.map((item) => materializeFunctions(item));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      next[key] = materializeFunctions(nestedValue);
    }
    return next;
  }
  return value;
}
