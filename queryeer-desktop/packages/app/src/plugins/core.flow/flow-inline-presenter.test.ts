import { describe, expect, it } from "vitest";
import { toFlowInlineNodeMarkers, toFlowInlineResultPresentation } from "./flow-inline-presenter";

describe("flow inline presenter", () => {
  it("returns undefined for missing execution", () => {
    const result = toFlowInlineResultPresentation(undefined);

    expect(result).toBeUndefined();
  });

  it("maps pending execution to not-run", () => {
    const result = toFlowInlineResultPresentation({
      nodeId: "n1",
      nodeType: "jdbc.query",
      status: "pending"
    });

    expect(result).toEqual(
      expect.objectContaining({
        statusClass: "not-run",
        title: "Not Run",
        detail: "Not part of the latest action."
      })
    );
  });

  it("maps completed execution with preview", () => {
    const result = toFlowInlineResultPresentation({
      nodeId: "n1",
      nodeType: "jdbc.query",
      status: "completed",
      output: {
        rowsAffected: 2,
        preview: "select 1"
      }
    });

    expect(result).toEqual(
      expect.objectContaining({
        statusClass: "completed",
        title: "Completed",
        detail: "Completed (2 rows).",
        preview: "select 1"
      })
    );
  });

  it("maps failure execution", () => {
    const result = toFlowInlineResultPresentation({
      nodeId: "n1",
      nodeType: "jdbc.query",
      status: "failed",
      error: {
        code: "NODE_EXECUTION_FAILED",
        message: "boom"
      }
    });

    expect(result).toEqual(
      expect.objectContaining({
        statusClass: "failed",
        title: "Failed",
        detail: "boom"
      })
    );
  });

  it("adds resolve action for missing mapping failures", () => {
    const result = toFlowInlineResultPresentation({
      nodeId: "n1",
      nodeType: "jdbc.query",
      status: "failed",
      error: {
        code: "FLOW_MAPPING_MISSING",
        message: "Missing flow mapping"
      }
    });

    expect(result).toEqual(
      expect.objectContaining({
        action: {
          kind: "resolve-mapping",
          label: "Resolve mapping"
        }
      })
    );
  });

  it("adds resolve action for invalid mapping failures", () => {
    const result = toFlowInlineResultPresentation({
      nodeId: "n1",
      nodeType: "jdbc.query",
      status: "failed",
      error: {
        code: "FLOW_MAPPING_INVALID",
        message: "Resolved mapping failed"
      }
    });

    expect(result?.action).toEqual({
      kind: "resolve-mapping",
      label: "Resolve mapping"
    });
  });

  it("maps blocked-by-failure skip reason", () => {
    const result = toFlowInlineResultPresentation({
      nodeId: "n2",
      nodeType: "payloadbuilder.query",
      status: "skipped",
      skipReason: "blockedByFailure"
    });

    expect(result).toEqual(
      expect.objectContaining({
        statusClass: "skipped",
        title: "Skipped",
        detail: "Skipped because an earlier node failed."
      })
    );
  });

  it("builds node markers from nodes and execution states", () => {
    const result = toFlowInlineNodeMarkers({
      nodes: [
        {
          metadata: { id: "a", type: "jdbc.query" },
          range: { metadataStartLine: 1 }
        },
        {
          metadata: { id: "b", type: "payloadbuilder.query" },
          range: { metadataStartLine: 8 }
        }
      ],
      executionNodes: [
        {
          nodeId: "a",
          nodeType: "jdbc.query",
          status: "completed"
        }
      ]
    });

    expect(result).toEqual([
      {
        nodeId: "a",
        lineNumber: 1,
        statusClass: "completed",
        hoverMessage: "a (jdbc.query)"
      },
      {
        nodeId: "b",
        lineNumber: 8,
        statusClass: "pending",
        hoverMessage: "b (payloadbuilder.query)"
      }
    ]);
  });
});
