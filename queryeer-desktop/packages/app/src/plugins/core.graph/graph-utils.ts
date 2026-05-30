import type { GraphDocument, GraphEdge, GraphEntity, GraphEntityType, GraphProperty, GraphPropertyGroup, GraphVertex } from "@queryeer/api/graph";

export type GraphValidationResult = {
  valid: boolean;
  errors: string[];
};

export function getImportantProperties(groups: GraphPropertyGroup[] | undefined): GraphProperty[] {
  return (groups ?? []).flatMap((group) => group.properties.filter((property) => property.important === true));
}

export function formatGraphPropertyValue(property: GraphProperty): string {
  const value = property.value === null ? "" : String(property.value);
  return property.unit ? `${value} ${property.unit}` : value;
}

export function resolveGraphEntity(graph: GraphDocument, type: "vertex", id: string): GraphEntity | null;
export function resolveGraphEntity(graph: GraphDocument, type: "edge", id: string): GraphEntity | null;
export function resolveGraphEntity(graph: GraphDocument, type: GraphEntityType, id: string): GraphEntity | null;
export function resolveGraphEntity(graph: GraphDocument, type: "vertex" | "edge", id: string): GraphEntity | null {
  if (type === "vertex") {
    const entity = graph.vertices.find((vertex) => vertex.id === id);
    return entity ? { type, entity } : null;
  }

  const entity = graph.edges.find((edge) => edge.id === id);
  return entity ? { type, entity } : null;
}

export function getGraphEntityProperties(entity: GraphEntity | null): GraphPropertyGroup[] {
  return entity?.entity.properties ?? [];
}

export function getGraphEntityActions(entity: GraphEntity | null) {
  return entity?.entity.actions ?? [];
}

export function validateGraphDocument(graph: GraphDocument): GraphValidationResult {
  const errors: string[] = [];
  const vertexIds = new Set<string>();
  const edgeIds = new Set<string>();

  for (const vertex of graph.vertices) {
    if (!vertex.id) {
      errors.push("Vertex id is required.");
      continue;
    }
    if (vertexIds.has(vertex.id)) {
      errors.push(`Duplicate vertex id '${vertex.id}'.`);
    }
    vertexIds.add(vertex.id);
  }

  for (const edge of graph.edges) {
    if (!edge.id) {
      errors.push("Edge id is required.");
      continue;
    }
    if (edgeIds.has(edge.id)) {
      errors.push(`Duplicate edge id '${edge.id}'.`);
    }
    edgeIds.add(edge.id);
    validateEndpoint(edge, edge.sourceVertexId, "source", vertexIds, errors);
    validateEndpoint(edge, edge.targetVertexId, "target", vertexIds, errors);
  }

  return { valid: errors.length === 0, errors };
}

function validateEndpoint(edge: GraphEdge, vertexId: string, role: "source" | "target", vertexIds: Set<string>, errors: string[]): void {
  if (!vertexId) {
    errors.push(`Edge '${edge.id}' ${role} vertex id is required.`);
  } else if (!vertexIds.has(vertexId)) {
    errors.push(`Edge '${edge.id}' references missing ${role} vertex '${vertexId}'.`);
  }
}

export function getGraphEntityLabel(entity: GraphVertex | GraphEdge): string {
  return "sourceVertexId" in entity
    ? entity.label ?? entity.id
    : entity.label;
}
