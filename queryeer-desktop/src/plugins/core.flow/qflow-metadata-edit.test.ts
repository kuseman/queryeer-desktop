import { describe, expect, it } from "vitest";
import { parseQflowDocument } from "./qflow-parser";
import { updateQflowNodeMetadataText } from "./qflow-metadata-edit";

describe("qflow metadata edit", () => {
  it("updates base metadata while preserving contribution metadata and action", () => {
    const source = [
      "%%queryeer-flow",
      "id: load",
      "type: jdbc.query",
      "description: \"Load rows\"",
      "jdbc:",
      "  connection: \"sales\"",
      "%%",
      "select 1"
    ].join("\n");

    const next = updateQflowNodeMetadataText({
      source,
      nodeId: "load",
      patch: {
        id: "load_orders",
        description: "Load order rows",
        runIf: "ctx.enabled"
      }
    });
    const parsed = parseQflowDocument(next);

    expect(parsed.nodes[0]?.metadata).toMatchObject({
      id: "load_orders",
      type: "jdbc.query",
      description: "Load order rows",
      runIf: "ctx.enabled",
      additional: {
        jdbc: {
          connection: "sales"
        }
      }
    });
    expect(parsed.nodes[0]?.action).toBe("select 1");
  });

  it("removes optional metadata when sidecar fields are cleared", () => {
    const source = [
      "%%queryeer-flow",
      "id: load",
      "type: jdbc.query",
      "description: \"Load rows\"",
      "runIf: \"ctx.enabled\"",
      "%%",
      "select 1"
    ].join("\n");

    const next = updateQflowNodeMetadataText({
      source,
      nodeId: "load",
      patch: {
        description: "",
        runIf: ""
      }
    });
    const parsed = parseQflowDocument(next);

    expect(parsed.nodes[0]?.metadata.description).toBeUndefined();
    expect(parsed.nodes[0]?.metadata.runIf).toBeUndefined();
  });
});
