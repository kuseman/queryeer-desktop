import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackendNotReadyError } from "../../contracts/backend/BackendNotReadyError";
import type { JdbcConnectionDefinition } from "./jdbc-settings";

const mocks = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getConfiguredJdbcConnectionsMock: vi.fn<() => JdbcConnectionDefinition[]>(() => [])
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({ invoke: mocks.invokeMock })
}));

vi.mock("./jdbc-settings", () => ({
  getConfiguredJdbcConnections: mocks.getConfiguredJdbcConnectionsMock
}));

// Import after mocks are set up
import { JdbcNavigationStore } from "./jdbc-navigation-store";

const connA: JdbcConnectionDefinition = {
  connectionId: "conn-a",
  title: "Connection A",
  dialectId: "jdbc",
  url: "jdbc:h2:mem:a",
  enabled: true
};
const connB: JdbcConnectionDefinition = {
  connectionId: "conn-b",
  title: undefined,
  dialectId: "postgres",
  url: "jdbc:postgresql://localhost/b",
  enabled: true
};
const connDisabled: JdbcConnectionDefinition = {
  connectionId: "conn-disabled",
  title: "Disabled",
  dialectId: "jdbc",
  url: "jdbc:h2:mem:disabled",
  enabled: false
};

const topResult = [
  {
    id: "database:mydb",
    name: "mydb",
    kind: "database",
    children: [
      {
        id: "schema:mydb|public",
        name: "public",
        kind: "schema",
        children: [],
        attributes: { catalog: "mydb" }
      }
    ],
    attributes: {}
  }
];

const tablesResult = [
  {
    id: "table:mydb|public:users",
    name: "users",
    kind: "table",
    children: [],
    attributes: { catalog: "mydb", schema: "public" }
  },
  {
    id: "table:mydb|public:orders",
    name: "orders",
    kind: "view",
    children: [],
    attributes: { catalog: "mydb", schema: "public" }
  }
];

const columnsResult = [
  {
    id: "column:mydb|public:users:id",
    name: "id",
    kind: "column",
    children: [],
    attributes: { type: "int4", nullable: "NO", ordinal: 1 }
  }
];

describe("JdbcNavigationStore", () => {
  let store: JdbcNavigationStore;

  beforeEach(() => {
    mocks.invokeMock.mockReset();
    mocks.getConfiguredJdbcConnectionsMock.mockReset();
    store = new JdbcNavigationStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loadConnectionRoots creates root nodes for enabled connections only", () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA, connB, connDisabled]);
    store.loadConnectionRoots();

    const state = store.getState();
    expect(state.connectionEntries).toHaveLength(2);
    expect(state.connectionEntries[0].connectionId).toBe("conn-a");
    expect(state.connectionEntries[1].connectionId).toBe("conn-b");

    const rootA = store.getNode("conn-a::__root__");
    expect(rootA).toBeDefined();
    expect(rootA?.kind).toBe("connection");
    expect(rootA?.isLoaded).toBe(false);
    expect(rootA?.isExpanded).toBe(false);
    expect(rootA?.name).toBe("Connection A");
  });

  it("expandNode on connection root calls jdbc.schema.fetch scope=top and populates children", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(topResult);
    store.loadConnectionRoots();

    await store.expandNode("conn-a::__root__");

    expect(mocks.invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        engineId: "jdbc",
        action: "jdbc.schema.fetch",
        payload: { connectionId: "conn-a", scope: "top" }
      }),
      expect.anything()
    );

    const root = store.getNode("conn-a::__root__");
    expect(root?.isExpanded).toBe(true);
    expect(root?.isLoaded).toBe(true);
    expect(root?.childIds).toHaveLength(1);

    const dbNode = store.getNode(root!.childIds[0]);
    expect(dbNode?.name).toBe("mydb");
    expect(dbNode?.kind).toBe("database");
    expect(dbNode?.isLoaded).toBe(true);
    expect(dbNode?.childIds).toHaveLength(1);

    const schemaNode = store.getNode(dbNode!.childIds[0]);
    expect(schemaNode?.name).toBe("public");
    expect(schemaNode?.kind).toBe("schema");
    expect(schemaNode?.isLoaded).toBe(false);
  });

  it("expandNode on database node does NOT call backend — children already loaded", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(topResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    mocks.invokeMock.mockClear();

    const root = store.getNode("conn-a::__root__")!;
    const dbNodeId = root.childIds[0];
    await store.expandNode(dbNodeId);

    expect(mocks.invokeMock).not.toHaveBeenCalled();
    expect(store.getNode(dbNodeId)?.isExpanded).toBe(true);
  });

  it("expandNode on schema node calls jdbc.schema.fetch scope=tables with correct target", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValueOnce(topResult).mockResolvedValueOnce(tablesResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");

    const root = store.getNode("conn-a::__root__")!;
    const dbNodeId = root.childIds[0];
    await store.expandNode(dbNodeId);
    const dbNode = store.getNode(dbNodeId)!;
    const schemaNodeId = dbNode.childIds[0];

    await store.expandNode(schemaNodeId);

    expect(mocks.invokeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        engineId: "jdbc",
        action: "jdbc.schema.fetch",
        payload: {
          connectionId: "conn-a",
          scope: "tables",
          target: { database: "mydb", schema: "public" }
        }
      }),
      expect.anything()
    );

    const schemaNode = store.getNode(schemaNodeId)!;
    expect(schemaNode.isLoaded).toBe(true);
    expect(schemaNode.childIds).toHaveLength(2);

    const tableNode = store.getNode(schemaNode.childIds[0]);
    expect(tableNode?.name).toBe("users");
    expect(tableNode?.isLoaded).toBe(false);
  });

  it("expandNode on table node calls jdbc.schema.fetch scope=columns with correct target", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock
      .mockResolvedValueOnce(topResult)
      .mockResolvedValueOnce(tablesResult)
      .mockResolvedValueOnce(columnsResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    const root = store.getNode("conn-a::__root__")!;
    await store.expandNode(root.childIds[0]);
    const dbNode = store.getNode(root.childIds[0])!;
    await store.expandNode(dbNode.childIds[0]);
    const schemaNode = store.getNode(dbNode.childIds[0])!;

    const tableNodeId = schemaNode.childIds[0];
    const tableNode = store.getNode(tableNodeId)!;
    await store.expandNode(tableNodeId);

    expect(mocks.invokeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        engineId: "jdbc",
        action: "jdbc.schema.fetch",
        payload: {
          connectionId: "conn-a",
          scope: "columns",
          target: { database: "mydb", schema: "public", table: tableNode.name }
        }
      }),
      expect.anything()
    );

    const refreshedTable = store.getNode(tableNodeId)!;
    expect(refreshedTable.isLoaded).toBe(true);
    expect(refreshedTable.childIds).toHaveLength(1);

    const colNode = store.getNode(refreshedTable.childIds[0]);
    expect(colNode?.name).toBe("id");
    expect(colNode?.kind).toBe("column");
  });

  it("expandNode is idempotent when already loaded", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(topResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    mocks.invokeMock.mockClear();

    await store.expandNode("conn-a::__root__");

    expect(mocks.invokeMock).not.toHaveBeenCalled();
  });

  it("expandNode guards against concurrent loads", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    let resolvePromise!: (v: unknown) => void;
    const pending = new Promise((r) => (resolvePromise = r));
    mocks.invokeMock.mockReturnValue(pending);
    store.loadConnectionRoots();

    const p1 = store.expandNode("conn-a::__root__");
    const p2 = store.expandNode("conn-a::__root__");
    resolvePromise(topResult);
    await Promise.all([p1, p2]);

    expect(mocks.invokeMock).toHaveBeenCalledTimes(1);
  });

  it("refreshNode clears isLoaded and re-fetches", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(topResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    mocks.invokeMock.mockClear();

    mocks.invokeMock.mockResolvedValue(topResult);
    await store.refreshNode("conn-a::__root__");

    expect(mocks.invokeMock).toHaveBeenCalledTimes(1);
    expect(store.getNode("conn-a::__root__")?.isLoaded).toBe(true);
  });

  it("collapseNode sets isExpanded=false and notifies listeners", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(topResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");

    const listener = vi.fn();
    store.subscribe(listener);
    store.collapseNode("conn-a::__root__");

    expect(store.getNode("conn-a::__root__")?.isExpanded).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("expandNode silently drops out when backend is not started", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockRejectedValue(new BackendNotReadyError());
    store.loadConnectionRoots();

    await store.expandNode("conn-a::__root__");

    const root = store.getNode("conn-a::__root__");
    expect(root?.isLoading).toBe(false);
    expect(root?.loadError).toBeUndefined();
    expect(root?.isExpanded).toBe(false);
  });

  it("expandNode handles null children from backend without crashing", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue([
      {
        id: "database:mydb",
        name: "mydb",
        kind: "database",
        children: null,
        attributes: {}
      }
    ]);
    store.loadConnectionRoots();

    await store.expandNode("conn-a::__root__");

    const root = store.getNode("conn-a::__root__");
    expect(root?.isExpanded).toBe(true);
    expect(root?.childIds).toHaveLength(1);

    const dbNode = store.getNode(root!.childIds[0]);
    expect(dbNode?.name).toBe("mydb");
    expect(dbNode?.childIds).toHaveLength(0);
  });

  it("expandNode with silent:true suppresses error display on failure", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockRejectedValue(new Error("Something went wrong"));
    store.loadConnectionRoots();

    await store.expandNode("conn-a::__root__", { silent: true });

    const root = store.getNode("conn-a::__root__");
    expect(root?.isLoading).toBe(false);
    expect(root?.loadError).toBeUndefined();
    expect(root?.isExpanded).toBe(false);
  });

  it("expandNode passes silent option through to service.invoke", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(topResult);
    store.loadConnectionRoots();

    await store.expandNode("conn-a::__root__", { silent: true });

    expect(mocks.invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({ engineId: "jdbc", action: "jdbc.schema.fetch" }),
      expect.objectContaining({ silent: true })
    );
  });
});
