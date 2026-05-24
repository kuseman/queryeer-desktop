import { describe, expect, it } from "vitest";
import { parseQflowDocument } from "./qflow-parser";
import { validateFlowNodeCoreMetadata } from "./flow-metadata-validation";
import type { FlowNode } from "./types";

describe("flow metadata validation", () => {
  it("returns no issues for valid core metadata", () => {
    const document = parseQflowDocument([
      "%%queryeer-flow",
      "id: first",
      "type: jdbc.query",
      "%%",
      "select 1"
    ].join("\n"));

    expect(validateFlowNodeCoreMetadata(document.nodes[0]!)).toEqual([]);
  });

  it("reports missing id and type", () => {
    const node = {
      index: 0,
      action: "select 1",
      range: {
        metadataStartLine: 1,
        metadataEndLine: 4,
        actionStartLine: 5,
        actionEndLine: 5
      },
      metadata: {
        id: "",
        type: ""
      }
    } satisfies FlowNode;

    expect(validateFlowNodeCoreMetadata(node)).toEqual([
      { field: "id", message: "Node id is required." },
      { field: "type", message: "Node type is required." }
    ]);
  });
});
