import { describe, expect, it } from "vitest";
import type { GraphDocument } from "@queryeer/api/graph";
import { graphDocumentToMermaid } from "./graph-mermaid";

describe("graphDocumentToMermaid", () => {
  it("exports vertices, properties, edges, and layout direction", () => {
    const graph: GraphDocument = {
      id: "orders",
      layout: { direction: "left-right" },
      vertices: [
        {
          id: "schema.Users",
          label: "Users",
          style: { shape: "rounded" },
          properties: [{
            id: "columns",
            label: "Columns",
            properties: [{ id: "id", label: "id", value: "int", important: true }],
          }],
        },
        { id: "schema.Orders", label: "Orders", style: { shape: "rectangle" } },
      ],
      edges: [{
        id: "fk",
        sourceVertexId: "schema.Orders",
        targetVertexId: "schema.Users",
        label: "user_id",
        style: { markerEnd: "arrow" },
      }],
    };

    expect(graphDocumentToMermaid(graph)).toBe([
      "flowchart LR",
      "    n0(\"Users<br/>Columns<br/>id: int\")",
      "    n1[\"Orders\"]",
      "    n1 -->|\"user_id\"| n0",
    ].join("\n"));
  });

  it("uses generated ids, escapes labels, and skips edges outside the document", () => {
    const graph: GraphDocument = {
      id: "special",
      vertices: [{ id: "not a mermaid id", label: "A | B & \"C\"", style: { shape: "diamond" } }],
      edges: [{ id: "missing", sourceVertexId: "not a mermaid id", targetVertexId: "missing" }],
    };

    expect(graphDocumentToMermaid(graph)).toBe([
      "flowchart TB",
      "    n0{\"A #124; B &amp; &quot;C&quot;\"}",
    ].join("\n"));
  });
});
