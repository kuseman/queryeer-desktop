import { describe, expect, it } from "vitest";
import type { GraphDocument } from "@queryeer/api/graph";
import { formatGraphPropertyValue, getImportantProperties, resolveGraphEntity, validateGraphDocument } from "./graph-utils";

describe("core.graph utilities", () => {
  it("picks important properties for tooltips", () => {
    const important = getImportantProperties([
      {
        id: "estimates",
        label: "Estimates",
        properties: [
          { id: "rows", label: "Rows", value: 42, important: true },
          { id: "cost", label: "Cost", value: 0.1 }
        ]
      }
    ]);

    expect(important).toEqual([{ id: "rows", label: "Rows", value: 42, important: true }]);
  });

  it("formats property units", () => {
    expect(formatGraphPropertyValue({ id: "duration", label: "Duration", value: 15, unit: "ms" })).toBe("15 ms");
  });

  it("resolves vertices and edges", () => {
    const graph: GraphDocument = {
      id: "g",
      vertices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ id: "e", sourceVertexId: "a", targetVertexId: "b" }]
    };

    expect(resolveGraphEntity(graph, "vertex", "a")?.entity.id).toBe("a");
    expect(resolveGraphEntity(graph, "edge", "e")?.entity.id).toBe("e");
    expect(resolveGraphEntity(graph, "edge", "missing")).toBeNull();
  });

  it("validates duplicate ids and missing edge endpoints", () => {
    const result = validateGraphDocument({
      id: "g",
      vertices: [{ id: "a", label: "A" }, { id: "a", label: "Duplicate" }],
      edges: [{ id: "e", sourceVertexId: "a", targetVertexId: "missing" }]
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Duplicate vertex id 'a'.");
    expect(result.errors).toContain("Edge 'e' references missing target vertex 'missing'.");
  });
});
