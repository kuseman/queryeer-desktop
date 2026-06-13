import type { GraphDocument } from "@queryeer/api/graph";

export function parseGraphDocumentJson(text: string): GraphDocument | null {
  try {
    return parseGraphDocument(JSON.parse(text));
  } catch {
    return null;
  }
}

export function parseGraphDocument(candidate: unknown): GraphDocument | null {
  if (!candidate || typeof candidate !== "object") {
    return null;
  }
  const graph = candidate as Partial<GraphDocument>;
  if (typeof graph.id !== "string" || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges)) {
    return null;
  }
  return graph as GraphDocument;
}

export function serializeGraphDocument(graph: GraphDocument): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}
