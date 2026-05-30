import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JdbcNavigationStore } from "./jdbc-navigation-store";
import { JdbcNavigationTree } from "./JdbcNavigationTree";
import type { JdbcConnectionDefinition } from "./jdbc-settings";

const mocks = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  getConfiguredJdbcConnectionsMock: vi.fn<() => JdbcConnectionDefinition[]>(() => []),
  backendStatusListeners: new Set<(status: { state: string }) => void>()
}));

vi.mock("../core.queryengine/QueryEngineService", () => ({
  getQueryEngineService: () => ({ invoke: mocks.invokeMock })
}));

vi.mock("./jdbc-settings", () => ({
  getConfiguredJdbcConnections: mocks.getConfiguredJdbcConnectionsMock
}));

vi.mock("../../renderer/shell/backend-status-service", () => ({
  getBackendStatusService: () => ({
    subscribe: vi.fn((listener: (status: { state: string }) => void) => {
      mocks.backendStatusListeners.add(listener);
      return () => mocks.backendStatusListeners.delete(listener);
    })
  })
}));

const connA: JdbcConnectionDefinition = {
  connectionId: "conn-a",
  title: "Connection A",
  dialectId: "jdbc",
  url: "jdbc:h2:a",
  enabled: true
};
const connB: JdbcConnectionDefinition = {
  connectionId: "conn-b",
  title: "Connection B",
  dialectId: "postgres",
  url: "jdbc:h2:b",
  enabled: true
};

const databasesContainerResult = [
  {
    id: "__databases__",
    name: "Databases",
    kind: "databases_container",
    nodeType: "container",
    children: [
      {
        id: "database:mydb",
        name: "mydb",
        kind: "database",
        nodeType: "structural",
        children: null,
        attributes: {}
      }
    ],
    attributes: {}
  }
];

const schemasContainerResult = [
  {
    id: "__schemas__:mydb",
    name: "Schemas",
    kind: "schemas_container",
    nodeType: "container",
    children: [
      {
        id: "schema:mydb|public",
        name: "public",
        kind: "schema",
        nodeType: "structural",
        children: null,
        attributes: { catalog: "mydb" }
      }
    ],
    attributes: {}
  }
];

const folderResult = [
  {
    id: "__tables_folder__",
    name: "Tables",
    kind: "tables_folder",
    nodeType: "folder",
    children: null,
    attributes: { catalog: "mydb", schema: "public" }
  }
];

const tablesResult = [
  {
    id: "table:mydb|public:users",
    name: "users",
    kind: "table",
    nodeType: "object",
    fullName: "public.users",
    children: null,
    attributes: { catalog: "mydb", schema: "public" }
  }
];

const columnsResult = [
  {
    id: "column:mydb|public:users:id",
    name: "id",
    kind: "column",
    nodeType: "property",
    children: null,
    attributes: { type: "decimal", nullable: "NO", ordinal: 1, precision: 18, scale: 2 }
  },
  {
    id: "column:mydb|public:users:name",
    name: "name",
    kind: "column",
    nodeType: "property",
    children: null,
    attributes: { type: "varchar", nullable: "YES", ordinal: 2, size: -1, precision: 0, scale: 0 }
  }
];

describe("JdbcNavigationTree", () => {
  let container: HTMLElement;
  let root: Root;
  let store: JdbcNavigationStore;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    store = new JdbcNavigationStore();
    mocks.invokeMock.mockReset();
    mocks.backendStatusListeners.clear();
    mocks.getConfiguredJdbcConnectionsMock.mockReset();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders one root row per configured connection", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA, connB]);
    store.loadConnectionRoots();

    await act(async () => {
      root.render(
        <JdbcNavigationTree
          store={store}
          activeFileConnectionId={undefined}
          activeFileDatabase={undefined}
        />
      );
    });

    const rows = container.querySelectorAll("[data-testid='jdbc-tree-node']");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Connection A");
    expect(rows[1].textContent).toContain("Connection B");
  });

  it("clicking connection root node calls store.expandNode", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    store.loadConnectionRoots();

    await act(async () => {
      root.render(
        <JdbcNavigationTree
          store={store}
          activeFileConnectionId={undefined}
          activeFileDatabase={undefined}
        />
      );
    });

    const row = container.querySelector<HTMLElement>("[data-testid='jdbc-tree-node']");
    await act(async () => {
      row!.click();
    });

    expect(store.getNode("conn-a::__root__")?.isExpanded).toBe(true);
  });

  it("auto-expands to active connection when linkToActiveFile is true", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    store.loadConnectionRoots();

    expect(store.getState().linkToActiveFile).toBe(true);

    await act(async () => {
      root.render(
        <JdbcNavigationTree
          store={store}
          activeFileConnectionId="conn-a"
          activeFileDatabase={undefined}
        />
      );
    });

    await act(async () => {});

    expect(store.getNode("conn-a::__root__")?.isExpanded).toBe(true);
    expect(mocks.invokeMock).toHaveBeenCalledWith(
      expect.objectContaining({ engineId: "jdbc", action: "jdbc.schema.fetch" }),
      expect.objectContaining({ silent: true })
    );
  });

  it("does NOT auto-expand when linkToActiveFile is false", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    store.loadConnectionRoots();
    store.toggleLinkToActiveFile();

    await act(async () => {
      root.render(
        <JdbcNavigationTree
          store={store}
          activeFileConnectionId="conn-a"
          activeFileDatabase={undefined}
        />
      );
    });

    await act(async () => {});

    expect(store.getNode("conn-a::__root__")?.isExpanded).toBe(false);
  });

  it("shows loading indicator for isLoading nodes", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    let resolveLoad!: (v: unknown) => void;
    mocks.invokeMock.mockReturnValue(new Promise((r) => (resolveLoad = r)));
    store.loadConnectionRoots();

    await act(async () => {
      root.render(
        <JdbcNavigationTree
          store={store}
          activeFileConnectionId={undefined}
          activeFileDatabase={undefined}
        />
      );
    });

    const row = container.querySelector<HTMLElement>("[data-testid='jdbc-tree-node']");
    act(() => {
      row!.click();
    });

    await act(async () => {});

    expect(container.querySelector("[data-testid='jdbc-tree-loading']")).not.toBeNull();

    await act(async () => {
      resolveLoad(databasesContainerResult);
    });

    expect(container.querySelector("[data-testid='jdbc-tree-loading']")).toBeNull();
  });

  it("auto-expands active connection when backend becomes healthy", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(databasesContainerResult);
    store.loadConnectionRoots();

    const expandSpy = vi.spyOn(store, "expandNode");

    await act(async () => {
      root.render(
        <JdbcNavigationTree
          store={store}
          activeFileConnectionId="conn-a"
          activeFileDatabase="mydb"
        />
      );
    });

    await act(async () => {});

    expandSpy.mockClear();

    await act(async () => {
      for (const listener of mocks.backendStatusListeners) {
        listener({ state: "unavailable" });
      }
    });

    await act(async () => {
      for (const listener of mocks.backendStatusListeners) {
        listener({ state: "healthy" });
      }
    });

    await act(async () => {});

    expect(expandSpy).toHaveBeenCalledWith("conn-a::__root__", { silent: true });
  });

  it("renders column label with type and nullability", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock
      .mockResolvedValueOnce(databasesContainerResult)
      .mockResolvedValueOnce(schemasContainerResult)
      .mockResolvedValueOnce(folderResult)
      .mockResolvedValueOnce(tablesResult)
      .mockResolvedValueOnce(columnsResult);
    store.loadConnectionRoots();

    // Walk tree: connection -> databases_container -> database -> schemas_container -> schema -> folder -> table
    await act(async () => {
      root.render(
        <JdbcNavigationTree
          store={store}
          activeFileConnectionId={undefined}
          activeFileDatabase={undefined}
        />
      );
    });

    const rows = () => container.querySelectorAll<HTMLElement>("[data-testid='jdbc-tree-node']");

    // Click connection
    await act(async () => { rows()[0]!.click(); });

    // Click databases_container (child index 1)
    await act(async () => { rows()[1]!.click(); });

    // Click database (child index 2)
    await act(async () => { rows()[2]!.click(); });

    // Click schemas_container (child index 3)
    await act(async () => { rows()[3]!.click(); });

    // Click schema (child index 4)
    await act(async () => { rows()[4]!.click(); });

    // Click tables_folder (child index 5)
    await act(async () => { rows()[5]!.click(); });

    // Find users table row and click
    const usersRow = Array.from(rows()).find((r) => r.textContent?.includes("public.users"));
    await act(async () => { usersRow?.click(); });

    expect(container.textContent).toContain("id decimal(18,2) not null");
    expect(container.textContent).toContain("name varchar(max) null");
  });
});
