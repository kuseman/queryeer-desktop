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

const topResult = [
  {
    id: "database:mydb",
    name: "mydb",
    kind: "database",
    children: [
      { id: "schema:mydb|public", name: "public", kind: "schema", children: [], attributes: { catalog: "mydb" } }
    ],
    attributes: {}
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
    mocks.invokeMock.mockResolvedValue(topResult);
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
    mocks.invokeMock.mockResolvedValue(topResult);
    store.loadConnectionRoots();

    // linkToActiveFile defaults to true
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
  });

  it("does NOT auto-expand when linkToActiveFile is false", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(topResult);
    store.loadConnectionRoots();
    store.toggleLinkToActiveFile(); // flip to false

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
      resolveLoad(topResult);
    });

    expect(container.querySelector("[data-testid='jdbc-tree-loading']")).toBeNull();
  });

  it("auto-expands active connection when backend becomes healthy", async () => {
    mocks.getConfiguredJdbcConnectionsMock.mockReturnValue([connA]);
    mocks.invokeMock.mockResolvedValue(topResult);
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

    // Clear spy calls from initial mount effect
    expandSpy.mockClear();

    // Simulate backend going down then healthy again
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
    expect(expandSpy).toHaveBeenCalledWith("conn-a::database:mydb", { silent: true });
  });
});
