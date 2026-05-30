import { describe, expect, it } from "vitest";
import type { JdbcTreeNode } from "./jdbc-navigation-types";

function buildNodeContext(node: JdbcTreeNode): Record<string, unknown> {
  return {
    node: {
      kind: node.kind,
      name: node.name,
      fullName: node.fullName ?? "",
      nodeType: node.nodeType,
      connectionId: node.connectionId,
      dialectId: node.dialectId,
      attributes: node.attributes ?? {}
    }
  };
}

function buildEngineState(node: JdbcTreeNode): Record<string, unknown> {
  const engineState: Record<string, unknown> = { connectionId: node.connectionId };
  if (node.kind === "database" && typeof node.attributes.catalog === "string") {
    engineState.database = node.attributes.catalog;
  } else if (node.kind === "database") {
    engineState.database = node.name;
  }
  return engineState;
}

describe("buildNodeContext", () => {
  it("builds context with all node properties including dialectId", () => {
    const node: JdbcTreeNode = {
      id: "conn1::dbo::procedures::sp_help",
      connectionId: "conn1",
      dialectId: "sqlserver",
      kind: "procedure",
      nodeType: "object",
      name: "sp_help",
      fullName: "dbo.sp_help",
      attributes: { schema: "dbo" },
      isExpanded: false,
      isLoaded: true,
      isLoading: false,
      loadError: undefined,
      childIds: []
    };

    const ctx = buildNodeContext(node);
    const nodeCtx = ctx.node as Record<string, unknown>;

    expect(nodeCtx.kind).toBe("procedure");
    expect(nodeCtx.name).toBe("sp_help");
    expect(nodeCtx.fullName).toBe("dbo.sp_help");
    expect(nodeCtx.nodeType).toBe("object");
    expect(nodeCtx.connectionId).toBe("conn1");
    expect(nodeCtx.dialectId).toBe("sqlserver");
    expect((nodeCtx.attributes as Record<string, unknown>).schema).toBe("dbo");
  });

  it("defaults fullName to empty string when undefined", () => {
    const node: JdbcTreeNode = {
      id: "conn1::tables::my_table",
      connectionId: "conn1",
      dialectId: "postgresql",
      kind: "table",
      nodeType: "object",
      name: "my_table",
      attributes: {},
      isExpanded: false,
      isLoaded: true,
      isLoading: false,
      loadError: undefined,
      childIds: []
    };

    const ctx = buildNodeContext(node);
    const nodeCtx = ctx.node as Record<string, unknown>;

    expect(nodeCtx.fullName).toBe("");
  });

  it("defaults attributes to empty object when undefined", () => {
    const node: JdbcTreeNode = {
      id: "conn1::root",
      connectionId: "conn1",
      dialectId: "jdbc",
      kind: "connection",
      nodeType: "container",
      name: "MyServer",
      attributes: {},
      isExpanded: false,
      isLoaded: true,
      isLoading: false,
      loadError: undefined,
      childIds: []
    };

    const ctx = buildNodeContext(node);
    const nodeCtx = ctx.node as Record<string, unknown>;

    expect(nodeCtx.attributes).toEqual({});
  });
});

describe("buildEngineState", () => {
  it("builds engine state with connectionId for any node type", () => {
    const node: JdbcTreeNode = {
      id: "conn1::dbo::tables::users",
      connectionId: "conn1",
      dialectId: "sqlserver",
      kind: "table",
      nodeType: "object",
      name: "users",
      attributes: {},
      isExpanded: false,
      isLoaded: true,
      isLoading: false,
      loadError: undefined,
      childIds: []
    };

    const state = buildEngineState(node);

    expect(state.connectionId).toBe("conn1");
    expect(state.database).toBeUndefined();
  });

  it("includes database from catalog attribute for database nodes", () => {
    const node: JdbcTreeNode = {
      id: "conn1::OrderService",
      connectionId: "conn1",
      dialectId: "sqlserver",
      kind: "database",
      nodeType: "structural",
      name: "OrderService",
      attributes: { catalog: "OrderService" },
      isExpanded: false,
      isLoaded: true,
      isLoading: false,
      loadError: undefined,
      childIds: []
    };

    const state = buildEngineState(node);

    expect(state.connectionId).toBe("conn1");
    expect(state.database).toBe("OrderService");
  });

  it("falls back to node name for database when catalog attribute is missing", () => {
    const node: JdbcTreeNode = {
      id: "conn1::mydb",
      connectionId: "conn1",
      dialectId: "postgresql",
      kind: "database",
      nodeType: "structural",
      name: "mydb",
      attributes: {},
      isExpanded: false,
      isLoaded: true,
      isLoading: false,
      loadError: undefined,
      childIds: []
    };

    const state = buildEngineState(node);

    expect(state.connectionId).toBe("conn1");
    expect(state.database).toBe("mydb");
  });

  it("does not include database for non-database nodes", () => {
    const node: JdbcTreeNode = {
      id: "conn1::dbo::procedures::sp_helptext",
      connectionId: "conn1",
      dialectId: "sqlserver",
      kind: "procedure",
      nodeType: "object",
      name: "sp_helptext",
      fullName: "dbo.sp_helptext",
      attributes: { schema: "dbo" },
      isExpanded: false,
      isLoaded: true,
      isLoading: false,
      loadError: undefined,
      childIds: []
    };

    const state = buildEngineState(node);

    expect(state.connectionId).toBe("conn1");
    expect(state.database).toBeUndefined();
  });
});
