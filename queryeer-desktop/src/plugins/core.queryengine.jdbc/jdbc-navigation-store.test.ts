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

import { JdbcNavigationStore } from "./jdbc-navigation-store";

const connA: JdbcConnectionDefinition = {
  connectionId: "conn-a", title: "Connection A", dialectId: "jdbc", url: "jdbc:h2:mem:a", enabled: true
};
const connB: JdbcConnectionDefinition = {
  connectionId: "conn-b", title: undefined, dialectId: "postgres", url: "jdbc:postgresql://localhost/b", enabled: true
};
const connDisabled: JdbcConnectionDefinition = {
  connectionId: "conn-disabled", title: "Disabled", dialectId: "jdbc", url: "jdbc:h2:mem:disabled", enabled: false
};

const databasesContainerResult = [
  { id: "__databases__", name: "Databases", kind: "databases_container", nodeType: "container",
    children: [{ id: "database:mydb", name: "mydb", kind: "database", nodeType: "structural", children: null, attributes: {} }],
    attributes: {} }
];

const schemasContainerResult = [
  { id: "__schemas__:mydb", name: "Schemas", kind: "schemas_container", nodeType: "container",
    children: [
      { id: "schema:mydb|public", name: "public", kind: "schema", nodeType: "structural", children: null, attributes: { catalog: "mydb" } },
      { id: "schema:mydb|pg_catalog", name: "pg_catalog", kind: "schema", nodeType: "structural", children: null, attributes: { catalog: "mydb" } }
    ],
    attributes: {} }
];

const folderResult = [
  { id: "tables_folder:mydb.public", name: "Tables", kind: "tables_folder", nodeType: "folder", children: null, attributes: { catalog: "mydb", schema: "public" } },
  { id: "views_folder:mydb.public", name: "Views", kind: "views_folder", nodeType: "folder", children: null, attributes: { catalog: "mydb", schema: "public" } }
];

const folderResultPgCatalog = [
  { id: "tables_folder:mydb.pg_catalog", name: "Tables", kind: "tables_folder", nodeType: "folder", children: null, attributes: { catalog: "mydb", schema: "pg_catalog" } },
  { id: "views_folder:mydb.pg_catalog", name: "Views", kind: "views_folder", nodeType: "folder", children: null, attributes: { catalog: "mydb", schema: "pg_catalog" } }
];

const tablesResult = [
  { id: "table:mydb|public:users", name: "users", kind: "table", nodeType: "object", fullName: "public.users", children: null, attributes: { catalog: "mydb", schema: "public" } },
  { id: "table:mydb|public:orders", name: "orders", kind: "view", nodeType: "object", fullName: "public.orders", children: null, attributes: { catalog: "mydb", schema: "public" } }
];

const columnsResult = [
  { id: "column:mydb|public:users:id", name: "id", kind: "column", nodeType: "property", children: null, attributes: { type: "int4", nullable: "NO", ordinal: 1 } }
];

describe("JdbcNavigationStore", () => {
  let store: JdbcNavigationStore;

  beforeEach(() => {
    mocks.invokeMock.mockReset();
    mocks.getConfiguredJdbcConnectionsMock.mockReset();
    store = new JdbcNavigationStore();
  });

  afterEach(() => vi.restoreAllMocks());

  it("loadConnectionRoots creates root nodes for enabled connections only", () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA, connB, connDisabled]);
    store.loadConnectionRoots();
    const state = store.getState();
    expect(state.connectionEntries).toHaveLength(2);
    expect(state.connectionEntries[0].connectionId).toBe("conn-a");
    expect(store.getNode("conn-a::__root__")?.kind).toBe("connection");
    expect(store.getNode("conn-a::__root__")?.nodeType).toBe("structural");
    expect(store.getNode("conn-a::__root__")?.isLoaded).toBe(false);
  });

  it("expandNode on connection root uses parentKind=connection", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    expect(mocks.invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({ engineId: "jdbc", action: "jdbc.schema.fetch", payload: { connectionId: "conn-a", parentKind: "connection" } }),
      expect.anything());
    const root = store.getNode("conn-a::__root__")!;
    expect(root.isExpanded).toBe(true);
    const container = store.getNode(root.childIds[0])!;
    expect(container.kind).toBe("databases_container");
    expect(container.childIds).toHaveLength(1);
  });

  it("expandNode on database uses parentKind=database", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValueOnce(databasesContainerResult).mockResolvedValueOnce(schemasContainerResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    const container = store.getNode(store.getNode("conn-a::__root__")!.childIds[0])!;
    await store.expandNode(container.childIds[0]);
    expect(mocks.invokeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: { connectionId: "conn-a", parentKind: "database", target: { database: "mydb" } } }),
      expect.anything());
  });

  it("expandNode on schema uses parentKind=schema with target", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValueOnce(databasesContainerResult).mockResolvedValueOnce(schemasContainerResult).mockResolvedValueOnce(folderResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    const container = store.getNode(store.getNode("conn-a::__root__")!.childIds[0])!;
    await store.expandNode(container.childIds[0]);
    const dbNode = store.getNode(container.childIds[0])!;
    await store.expandNode(dbNode.childIds[0]);
    const schemasContainer = store.getNode(dbNode.childIds[0])!;
    await store.expandNode(schemasContainer.childIds[0]);
    expect(mocks.invokeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: { connectionId: "conn-a", parentKind: "schema", target: { database: "mydb", schema: "public" } } }),
      expect.anything());
  });

  it("expandNode on folder uses parentKind=folder_kind", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValueOnce(databasesContainerResult).mockResolvedValueOnce(schemasContainerResult).mockResolvedValueOnce(folderResult).mockResolvedValueOnce(tablesResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    const container = store.getNode(store.getNode("conn-a::__root__")!.childIds[0])!;
    await store.expandNode(container.childIds[0]);
    const dbNode = store.getNode(container.childIds[0])!;
    await store.expandNode(dbNode.childIds[0]);
    const schemasContainer = store.getNode(dbNode.childIds[0])!;
    await store.expandNode(schemasContainer.childIds[0]);
    const schemaNode = store.getNode(schemasContainer.childIds[0])!;
    await store.expandNode(schemaNode.childIds[0]);
    expect(mocks.invokeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: { connectionId: "conn-a", parentKind: "tables_folder", target: { database: "mydb", schema: "public" } } }),
      expect.anything());
    const folderNode = store.getNode(schemaNode.childIds[0])!;
    expect(folderNode.isLoaded).toBe(true);
    expect(folderNode.childIds).toHaveLength(2);
    const tableNode = store.getNode(folderNode.childIds[0]);
    expect(tableNode?.fullName).toBe("public.users");
    expect(tableNode?.nodeType).toBe("object");
  });

  it("expandNode on table uses parentKind=table with target", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValueOnce(databasesContainerResult).mockResolvedValueOnce(schemasContainerResult).mockResolvedValueOnce(folderResult).mockResolvedValueOnce(tablesResult).mockResolvedValueOnce(columnsResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    const container = store.getNode(store.getNode("conn-a::__root__")!.childIds[0])!;
    await store.expandNode(container.childIds[0]);
    const dbNode = store.getNode(container.childIds[0])!;
    await store.expandNode(dbNode.childIds[0]);
    const schemasContainer = store.getNode(dbNode.childIds[0])!;
    await store.expandNode(schemasContainer.childIds[0]);
    const schemaNode = store.getNode(schemasContainer.childIds[0])!;
    await store.expandNode(schemaNode.childIds[0]);
    const folderNode = store.getNode(schemaNode.childIds[0])!;
    await store.expandNode(folderNode.childIds[0]);
    expect(mocks.invokeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ payload: { connectionId: "conn-a", parentKind: "table", target: { database: "mydb", schema: "public", table: "users" } } }),
      expect.anything());
    const tableNode = store.getNode(folderNode.childIds[0])!;
    expect(tableNode.isLoaded).toBe(true);
    expect(tableNode.childIds).toHaveLength(1);
    const colNode = store.getNode(tableNode.childIds[0]);
    expect(colNode?.kind).toBe("column");
    expect(colNode?.nodeType).toBe("property");
  });

  it("expandNode is idempotent when already loaded", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    mocks.invokeMock.mockClear();
    await store.expandNode("conn-a::__root__");
    expect(mocks.invokeMock).not.toHaveBeenCalled();
  });

  it("expanding two different schemas produces independent folder nodes", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock
      .mockResolvedValueOnce(databasesContainerResult)
      .mockResolvedValueOnce(schemasContainerResult)
      .mockResolvedValueOnce(folderResult)
      .mockResolvedValueOnce(folderResultPgCatalog);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    const container = store.getNode(store.getNode("conn-a::__root__")!.childIds[0])!;
    await store.expandNode(container.childIds[0]);
    const dbNode = store.getNode(container.childIds[0])!;
    await store.expandNode(dbNode.childIds[0]);
    const schemasContainer = store.getNode(dbNode.childIds[0])!;
    // Expand schema "public"
    const publicSchemaId = schemasContainer.childIds[0];
    await store.expandNode(publicSchemaId);
    const publicSchemaNode = store.getNode(publicSchemaId)!;
    const publicFolderId = publicSchemaNode.childIds[0];
    const publicFolder = store.getNode(publicFolderId)!;
    expect(publicFolder.attributes.schema).toBe("public");
    // Expand schema "pg_catalog"
    const pgSchemaId = schemasContainer.childIds[1];
    await store.expandNode(pgSchemaId);
    const pgSchemaNode = store.getNode(pgSchemaId)!;
    const pgFolderId = pgSchemaNode.childIds[0];
    const pgFolder = store.getNode(pgFolderId)!;
    expect(pgFolder.attributes.schema).toBe("pg_catalog");
    // Verify public's folder is NOT overwritten by pg_catalog
    const publicFolderAfter = store.getNode(publicFolderId)!;
    expect(publicFolderAfter.attributes.schema).toBe("public");
    // Node IDs must differ
    expect(publicFolderId).not.toBe(pgFolderId);
  });

  it("expandNode guards against concurrent loads", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    let resolvePromise: (v: unknown) => void = () => {};
    const pending = new Promise((r) => (resolvePromise = r));
    mocks.invokeMock.mockReturnValue(pending);
    store.loadConnectionRoots();
    const p1 = store.expandNode("conn-a::__root__");
    const p2 = store.expandNode("conn-a::__root__");
    resolvePromise(databasesContainerResult);
    await Promise.all([p1, p2]);
    expect(mocks.invokeMock).toHaveBeenCalledTimes(1);
  });

  it("refreshNode clears isLoaded and re-fetches", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    mocks.invokeMock.mockClear();
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    await store.refreshNode("conn-a::__root__");
    expect(mocks.invokeMock).toHaveBeenCalledTimes(1);
    expect(store.getNode("conn-a::__root__")?.isLoaded).toBe(true);
  });

  it("collapseNode sets isExpanded=false", () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    store.loadConnectionRoots();
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
    expect(store.getNode("conn-a::__root__")?.isLoading).toBe(false);
    expect(store.getNode("conn-a::__root__")?.loadError).toBeUndefined();
  });

  it("handles null children from backend", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue([{ id: "id", name: "test", kind: "tables_folder", nodeType: "folder", children: null, attributes: {} }]);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__");
    expect(store.getNode("conn-a::__root__")!.childIds).toHaveLength(1);
    expect(store.getNode(store.getNode("conn-a::__root__")!.childIds[0])?.childIds).toHaveLength(0);
  });

  it("expandNode with silent suppresses error display", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockRejectedValue(new Error("fail"));
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__", { silent: true });
    expect(store.getNode("conn-a::__root__")?.loadError).toBeUndefined();
  });

  it("expandNode passes silent option to service.invoke", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    store.loadConnectionRoots();
    await store.expandNode("conn-a::__root__", { silent: true });
    expect(mocks.invokeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ silent: true }));
  });
});
