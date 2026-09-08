import type { GraphDocument, GraphEdge, GraphVertex, GraphVertexShape } from "@queryeer/api/graph";

const directionMap = {
  "top-bottom": "TB",
  "bottom-top": "BT",
  "left-right": "LR",
  "right-left": "RL",
} as const;

export function graphDocumentToMermaid(graph: GraphDocument): string {
  const nodeIdByVertexId = new Map(graph.vertices.map((vertex, index) => [vertex.id, `n${index}`]));
  const direction = directionMap[graph.layout?.direction ?? "top-bottom"];
  const lines = [`flowchart ${direction}`];

  for (const vertex of graph.vertices) {
    const nodeId = nodeIdByVertexId.get(vertex.id)!;
    lines.push(`    ${formatVertex(nodeId, vertex)}`);
  }

  for (const edge of graph.edges) {
    const sourceId = nodeIdByVertexId.get(edge.sourceVertexId);
    const targetId = nodeIdByVertexId.get(edge.targetVertexId);
    if (sourceId && targetId) {
      lines.push(`    ${formatEdge(sourceId, targetId, edge)}`);
    }
  }

  return lines.join("\n");
}

function formatVertex(id: string, vertex: GraphVertex): string {
  const labelLines = [vertex.label];
  for (const group of vertex.properties ?? []) {
    if (group.properties.length === 0) continue;
    labelLines.push(group.label);
    for (const property of group.properties) {
      const unit = property.unit ? ` ${property.unit}` : "";
      labelLines.push(`${property.label}: ${String(property.value ?? "")}${unit}`);
    }
  }

  const label = labelLines.map(escapeLabel).join("<br/>");
  return `${id}${nodeDelimiters(vertex.style?.shape, label)}`;
}

function nodeDelimiters(shape: GraphVertexShape | undefined, label: string): string {
  switch (shape) {
    case "ellipse": return `(("${label}"))`;
    case "diamond": return `{"${label}"}`;
    case "rounded": return `("${label}")`;
    case "rectangle":
    default: return `["${label}"]`;
  }
}

function formatEdge(sourceId: string, targetId: string, edge: GraphEdge): string {
  const arrow = edge.style?.markerEnd === "none" ? "---" : "-->";
  const label = edge.label ? `|"${escapeLabel(edge.label)}"|` : "";
  return `${sourceId} ${arrow}${label} ${targetId}`;
}

function escapeLabel(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\|/g, "#124;")
    .replace(/\r?\n/g, " ");
}
