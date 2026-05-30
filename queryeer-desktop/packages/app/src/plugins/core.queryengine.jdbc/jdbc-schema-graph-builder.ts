import type { GraphDocument, GraphEdge, GraphProperty, GraphVertex } from "@queryeer/api/graph";
import type { JdbcSchemaObject } from "./jdbc-navigation-types";

type TableVertex = {
  schema: string;
  shortName: string;
  vertex: GraphVertex;
  fkRefs: Array<{
    colName: string;
    refTable: string;
  }>;
};

export function buildSchemaGraph(
  snapshotRoots: JdbcSchemaObject[],
  databaseName: string
): GraphDocument {
  const database = findDatabase(snapshotRoots, databaseName);
  if (!database) {
    return { id: `er-${sanitizeId(databaseName)}`, title: `ER Diagram - ${databaseName}`, vertices: [], edges: [] };
  }

  const flatTables = collectTables(database.children ?? []);
  const vertices = buildVertices(flatTables);
  const vertexById = new Map(vertices.map((v) => [v.vertex.id, v]));
  const edges = buildEdges(vertices, vertexById);

  return {
    id: `er-${sanitizeId(databaseName)}`,
    title: `ER Diagram - ${databaseName}`,
    layout: {
      direction: "left-right",
      rankSpacing: 100,
      nodeSpacing: 80,
    },
    vertices: vertices.map((v) => v.vertex),
    edges,
  };
}

function findDatabase(roots: JdbcSchemaObject[], name: string): JdbcSchemaObject | undefined {
  for (const root of roots) {
    if (root.kind === "database" && matchesName(root, name)) {
      return root;
    }
    if (root.children?.length) {
      const found = findDatabase(root.children, name);
      if (found) return found;
    }
  }
  return undefined;
}

function matchesName(obj: JdbcSchemaObject, name: string): boolean {
  return obj.name.toLowerCase() === name.toLowerCase()
    || (typeof obj.attributes.catalog === "string" && obj.attributes.catalog.toLowerCase() === name.toLowerCase());
}

type FlatTable = {
  node: JdbcSchemaObject;
  schema: string;
  kind: "TABLE" | "VIEW";
  columns: Array<{
    name: string;
    type: string;
    isPk: boolean;
    isFk: boolean;
    refTable: string | undefined;
  }>;
};

function collectTables(nodes: JdbcSchemaObject[]): FlatTable[] {
  const result: FlatTable[] = [];
  walkTables(nodes, undefined, result);
  return result;
}

function walkTables(
  nodes: JdbcSchemaObject[],
  currentSchema: string | undefined,
  out: FlatTable[]
): void {
  for (const node of nodes) {
    if (node.kind === "schema") {
      walkTables(node.children ?? [], node.name, out);
      continue;
    }
    if (node.kind === "tables_folder" || node.kind === "views_folder") {
      walkTables(node.children ?? [], currentSchema, out);
      continue;
    }
    if (node.kind === "table" || node.kind === "view") {
      const columns = extractColumns(node);
      out.push({
        node,
        schema: currentSchema ?? extractSchemaAttr(node),
        kind: node.kind === "view" ? "VIEW" : "TABLE",
        columns,
      });
      continue;
    }
    if (node.children?.length) {
      walkTables(node.children, currentSchema, out);
    }
  }
}

function extractSchemaAttr(node: JdbcSchemaObject): string {
  const schema = node.attributes.schema;
  return typeof schema === "string" && schema.length > 0 ? schema : "";
}

function extractColumns(table: JdbcSchemaObject): FlatTable["columns"] {
  const columns: FlatTable["columns"] = [];
  const children = table.children ?? [];
  for (const child of children) {
    if (child.kind === "columns_folder" && child.children?.length) {
      for (const col of child.children) {
        if (col.kind === "column") {
          columns.push({
            name: col.name,
            type: stringAttr(col.attributes.type, ""),
            isPk: col.attributes.primaryKey === true,
            isFk: col.attributes.foreignKey === true,
            refTable: stringAttr(col.attributes.referencesTable, undefined),
          });
        }
      }
      break;
    }
  }
  return columns;
}

function stringAttr(value: unknown, fallback: string): string;
function stringAttr(value: unknown, fallback: string | undefined): string | undefined;
function stringAttr(value: unknown, fallback: string | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function vertexId(qualifiedName: string): string {
  return "table-" + sanitizeId(qualifiedName);
}

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:.-]/g, "_");
}

function buildVertices(tables: FlatTable[]): TableVertex[] {
  return tables.map((table) => {
    const qualifiedName = table.node.fullName && table.node.fullName !== table.node.name
      ? table.node.fullName
      : table.schema
        ? `${table.schema}.${table.node.name}`
        : table.node.name;
    const id = vertexId(qualifiedName);
    const columnProperties: GraphProperty[] = table.columns.map((col) => ({
      id: col.name,
      label: col.name,
      value: col.type,
      unit: col.isFk ? "FK" : undefined,
      important: col.isPk || undefined,
    }));

    const columnCount = Math.max(columnProperties.length, 1);
    const estimatedHeight = 36 + columnCount * 24;

    const vertex: GraphVertex = {
      id,
      kind: table.kind,
      label: table.schema ? `${table.schema}.${table.node.name}` : table.node.name,
      style: {
        shape: "rounded",
        width: 280,
        height: estimatedHeight,
      },
      properties: [
        {
          id: "columns",
          label: "Columns",
          properties: columnProperties,
        },
      ],
    };

    return {
      schema: table.schema,
      shortName: table.node.name,
      vertex,
      fkRefs: table.columns
        .filter((col) => col.isFk && col.refTable)
        .map((col) => ({
          colName: col.name,
          refTable: col.refTable!,
        })),
    };
  });
}

function buildEdges(tables: TableVertex[], _vertexById: Map<string, TableVertex>): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const source of tables) {
    for (const fk of source.fkRefs) {
      const target = findTargetVertex(tables, fk.refTable, source.schema);
      if (!target) continue;

      const edgeId = `fk-${source.vertex.id}-${fk.colName}`;
      if (edges.some((e) => e.id === edgeId)) continue;

      edges.push({
        id: edgeId,
        sourceVertexId: source.vertex.id,
        targetVertexId: target.vertex.id,
        label: fk.colName,
        kind: "fk",
        style: {
          color: "#6366f1",
          dash: true,
          markerEnd: "arrow",
          width: 1.5,
        },
      });
    }
  }

  return edges;
}

function findTargetVertex(
  tables: TableVertex[],
  refTable: string,
  sourceSchema: string
): TableVertex | undefined {
  const normalizedRef = refTable.toLowerCase();
  return tables.find((t) => {
    const nameMatch = t.shortName.toLowerCase() === normalizedRef;
    if (!nameMatch) return false;
    if (!sourceSchema) return true;
    return t.schema.toLowerCase() === sourceSchema.toLowerCase();
  });
}
