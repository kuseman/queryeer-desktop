import { describe, expect, it } from "vitest";
import { dagreGraphLayoutProvider } from "./graph-layout";

describe("dagre graph layout", () => {
  it("positions source before target in left-right layout", () => {
    const layout = dagreGraphLayoutProvider.layout({
      id: "g",
      layout: { direction: "left-right" },
      vertices: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      edges: [{ id: "e", sourceVertexId: "a", targetVertexId: "b" }]
    });

    const a = layout.vertices.find((vertex) => vertex.id === "a")!;
    const b = layout.vertices.find((vertex) => vertex.id === "b")!;

    expect(a.position.x).toBeLessThan(b.position.x);
  });
});
