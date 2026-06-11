import { describe, expect, it } from "vitest";
import type { JdbcSchemaObject } from "./jdbc-navigation-types";
import { buildSchemaGraph } from "./jdbc-schema-graph-builder";

function col(name: string, overrides: Partial<JdbcSchemaObject["attributes"]> = {}): JdbcSchemaObject {
  return {
    id: `col-${name}`,
    name,
    kind: "column",
    nodeType: "property",
    attributes: { type: "int", nullable: "NO", ordinal: 1, ...overrides },
  };
}

function columnsFolder(cols: JdbcSchemaObject[]): JdbcSchemaObject {
  return {
    id: "columns-folder",
    name: "Columns",
    kind: "columns_folder",
    nodeType: "container",
    children: cols,
    attributes: {},
  };
}

function table(name: string, schema: string, cols: JdbcSchemaObject[], kind: "table" | "view" = "table"): JdbcSchemaObject {
  return {
    id: `${schema}.${name}`,
    name,
    kind,
    nodeType: "object" as const,
    fullName: `${schema}.${name}`,
    children: [columnsFolder(cols)],
    attributes: { schema, catalog: "testdb" },
  };
}

function schema(name: string, children: JdbcSchemaObject[]): JdbcSchemaObject {
  return {
    id: `schema-${name}`,
    name,
    kind: "schema",
    nodeType: "structural" as const,
    children,
    attributes: { catalog: "testdb" },
  };
}

function database(name: string, children: JdbcSchemaObject[]): JdbcSchemaObject {
  return {
    id: `db-${name}`,
    name,
    kind: "database",
    nodeType: "structural" as const,
    children,
    attributes: { catalog: name },
  };
}

describe("buildSchemaGraph", () => {
  it("returns empty graph for empty snapshot", () => {
    const result = buildSchemaGraph([], "testdb");
    expect(result.vertices).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.id).toBe("er-testdb");
  });

  it("returns empty graph when database not found", () => {
    const root = database("otherdb", []);
    const result = buildSchemaGraph([root], "testdb");
    expect(result.vertices).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it("creates a vertex for a single table with columns", () => {
    const root = database("testdb", [
      schema("dbo", [
        table("Users", "dbo", [
          col("id", { primaryKey: true, type: "int" }),
          col("name", { type: "varchar(100)" }),
        ]),
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    expect(result.vertices).toHaveLength(1);
    expect(result.edges).toHaveLength(0);

    const v = result.vertices[0]!;
    expect(v.kind).toBe("TABLE");
    expect(v.label).toBe("dbo.Users");
    expect(v.description).toBeUndefined();
    expect(v.properties).toBeDefined();

    const cols = v.properties![0]!.properties;
    expect(cols).toHaveLength(2);
    expect(cols[0]!.label).toBe("id");
    expect(cols[0]!.important).toBe(true);
    expect(cols[0]!.unit).toBeUndefined();
    expect(cols[1]!.label).toBe("name");
    expect(cols[1]!.important).toBeUndefined();
  });

  it("creates FK edge between two tables", () => {
    const root = database("testdb", [
      schema("dbo", [
        table("Users", "dbo", [
          col("id", { primaryKey: true, type: "int" }),
        ]),
        table("Orders", "dbo", [
          col("id", { primaryKey: true, type: "int" }),
          col("user_id", { type: "int", foreignKey: true, referencesTable: "Users", referencesColumn: "id" }),
        ]),
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    expect(result.vertices).toHaveLength(2);
    expect(result.edges).toHaveLength(1);

    const edge = result.edges[0]!;
    expect(edge.sourceVertexId).toContain("Orders");
    expect(edge.targetVertexId).toContain("Users");
    expect(edge.kind).toBe("fk");
    expect(edge.style?.dash).toBe(true);
    expect(edge.style?.color).toBe("#6366f1");
    expect(edge.style?.markerEnd).toBe("arrow");
    expect(edge.label).toBe("user_id");
  });

  it("skips FK when referenced table is not in the graph", () => {
    const root = database("testdb", [
      schema("dbo", [
        table("Orders", "dbo", [
          col("id", { primaryKey: true, type: "int" }),
          col("user_id", { type: "int", foreignKey: true, referencesTable: "NonExistent", referencesColumn: "id" }),
        ]),
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    expect(result.vertices).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it("matches FK only within same schema", () => {
    const root = database("testdb", [
      schema("dbo", [
        table("Users", "dbo", [
          col("id", { primaryKey: true, type: "int" }),
        ]),
      ]),
      schema("audit", [
        table("Users", "audit", [
          col("id", { primaryKey: true, type: "int" }),
        ]),
        table("Orders", "audit", [
          col("id", { primaryKey: true, type: "int" }),
          col("user_id", { type: "int", foreignKey: true, referencesTable: "Users", referencesColumn: "id" }),
        ]),
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    expect(result.vertices).toHaveLength(3);
    // One FK within audit schema (Orders -> audit.Users)
    // dbo.Users should NOT match since source schema is "audit"
    const dboUsers = result.vertices.find((v) => v.label === "dbo.Users");
    expect(dboUsers).toBeDefined();
    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0]!;
    const targetLabel = result.vertices.find((v) => v.id === edge.targetVertexId)?.label;
    expect(targetLabel).toBe("audit.Users");
  });

  it("handles views with different kind", () => {
    const root = database("testdb", [
      schema("dbo", [
        table("Users", "dbo", [col("id", { primaryKey: true, type: "int" })]),
        table("UserSummary", "dbo", [col("id", { type: "int" })], "view"),
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    expect(result.vertices).toHaveLength(2);

    const tblV = result.vertices.find((v) => v.kind === "TABLE");
    const viewV = result.vertices.find((v) => v.kind === "VIEW");
    expect(tblV).toBeDefined();
    expect(viewV).toBeDefined();
    expect(viewV!.label).toBe("dbo.UserSummary");
  });

  it("sets correct vertex ids and layout", () => {
    const root = database("testdb", [
      schema("dbo", [
        table("Items", "dbo", [col("id", { primaryKey: true, type: "int" })]),
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    expect(result.id).toBe("er-testdb");
    expect(result.title).toBe("ER Diagram - testdb");
    expect(result.layout?.direction).toBe("top-bottom");
    expect(result.vertices[0]!.id).toContain("table-");
  });

  it("handles table with no columns gracefully", () => {
    const root = database("testdb", [
      schema("dbo", [
        { ...table("EmptyTable", "dbo", []), children: [] },
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    expect(result.vertices).toHaveLength(1);
    expect(result.vertices[0]!.properties![0]!.properties).toHaveLength(0);
  });

  it("sets PK column as important and FK column with FK unit", () => {
    const root = database("testdb", [
      schema("dbo", [
        table("Orders", "dbo", [
          col("id", { primaryKey: true, type: "int" }),
          col("user_id", { type: "int", foreignKey: true, referencesTable: "Users", referencesColumn: "id" }),
        ]),
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    const cols = result.vertices[0]!.properties![0]!.properties;
    const pkCol = cols.find((c) => c.label === "id")!;
    const fkCol = cols.find((c) => c.label === "user_id")!;
    expect(pkCol.important).toBe(true);
    expect(pkCol.unit).toBeUndefined();
    expect(fkCol.unit).toBe("FK");
    expect(fkCol.important).toBeUndefined();
  });

  it("produces unique vertex IDs for same-named tables across schemas when fullName lacks qualifier", () => {
    // Simulates snapshot data where fullName was lost during persist/retrieve
    function tableNoFullName(name: string, schema: string, cols: JdbcSchemaObject[], kind: "table" | "view" = "table"): JdbcSchemaObject {
      return {
        id: `${schema}.${name}`,
        name,
        kind,
        nodeType: "object" as const,
        fullName: name,
        children: [columnsFolder(cols)],
        attributes: { schema, catalog: "testdb" },
      };
    }

    const root = database("testdb", [
      schema("dbo", [
        tableNoFullName("Users", "dbo", [
          col("id", { primaryKey: true, type: "int" }),
        ]),
      ]),
      schema("audit", [
        tableNoFullName("Users", "audit", [
          col("id", { primaryKey: true, type: "int" }),
        ]),
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    expect(result.vertices).toHaveLength(2);

    const ids = result.vertices.map((v) => v.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids.some((id) => id.includes("dbo.Users"))).toBe(true);
    expect(ids.some((id) => id.includes("audit.Users"))).toBe(true);
  });

  it("produces unique vertex IDs for same-named tables across schemas with proper fullName", () => {
    const root = database("testdb", [
      schema("dbo", [
        table("Entity", "dbo", [col("id", { primaryKey: true, type: "int" })]),
      ]),
      schema("ext", [
        table("Entity", "ext", [col("id", { primaryKey: true, type: "int" })]),
      ]),
    ]);

    const result = buildSchemaGraph([root], "testdb");
    expect(result.vertices).toHaveLength(2);

    const ids = result.vertices.map((v) => v.id);
    expect(new Set(ids).size).toBe(2);
  });
});
