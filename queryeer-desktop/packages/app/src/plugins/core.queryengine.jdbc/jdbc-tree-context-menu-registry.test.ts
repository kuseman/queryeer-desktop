import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getJdbcTreeContextMenuRegistry,
  resetJdbcTreeContextMenuRegistry
} from "./jdbc-tree-context-menu-registry";
import type { JdbcTreeNode } from "./jdbc-navigation-types";

function makeNode(overrides: Partial<JdbcTreeNode> = {}): JdbcTreeNode {
  return {
    id: "test-node",
    connectionId: "conn-1",
    dialectId: "jdbc",
    kind: "connection",
    nodeType: "structural",
    name: "Test Connection",
    attributes: {},
    isExpanded: false,
    isLoaded: true,
    isLoading: false,
    loadError: undefined,
    childIds: [],
    ...overrides
  };
}

describe("JdbcTreeContextMenuRegistry", () => {
  beforeEach(() => {
    resetJdbcTreeContextMenuRegistry();
  });

  it("returns empty array when no contributions registered", () => {
    const registry = getJdbcTreeContextMenuRegistry();
    const node = makeNode();
    const items = registry.getItemsForNode(node);
    expect(items).toHaveLength(0);
  });

  it("returns matching contributions for a node", () => {
    const registry = getJdbcTreeContextMenuRegistry();
    registry.registerContribution({
      id: "test.connection-action",
      label: "Connection Action",
      order: 10,
      matches: (node) => node.kind === "connection",
      run: vi.fn()
    });

    const connNode = makeNode({ kind: "connection" });
    const items = registry.getItemsForNode(connNode);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("test.connection-action");
    expect(items[0].label).toBe("Connection Action");
  });

  it("does not return contributions that do not match", () => {
    const registry = getJdbcTreeContextMenuRegistry();
    registry.registerContribution({
      id: "test.db-action",
      label: "Database Action",
      order: 10,
      matches: (node) => node.kind === "database",
      run: vi.fn()
    });

    const connNode = makeNode({ kind: "connection" });
    const items = registry.getItemsForNode(connNode);
    expect(items).toHaveLength(0);
  });

  it("orders contributions by order field", () => {
    const registry = getJdbcTreeContextMenuRegistry();
    registry.registerContribution({
      id: "test.second",
      label: "Second",
      order: 20,
      matches: () => true,
      run: vi.fn()
    });
    registry.registerContribution({
      id: "test.first",
      label: "First",
      order: 10,
      matches: () => true,
      run: vi.fn()
    });

    const node = makeNode();
    const items = registry.getItemsForNode(node);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("test.first");
    expect(items[1].id).toBe("test.second");
  });

  it("includes section in returned items", () => {
    const registry = getJdbcTreeContextMenuRegistry();
    registry.registerContribution({
      id: "test.query",
      label: "New Query",
      order: 10,
      matches: () => true,
      run: vi.fn(),
      section: "query"
    });

    const items = registry.getItemsForNode(makeNode());
    expect(items[0].section).toBe("query");
  });

  it("unregisterContribution removes the contribution", () => {
    const registry = getJdbcTreeContextMenuRegistry();
    registry.registerContribution({
      id: "test.temp",
      label: "Temporary",
      order: 10,
      matches: () => true,
      run: vi.fn()
    });

    expect(registry.getItemsForNode(makeNode())).toHaveLength(1);

    registry.unregisterContribution("test.temp");
    expect(registry.getItemsForNode(makeNode())).toHaveLength(0);
  });

  it("passes node to contribution run handler", () => {
    const runFn = vi.fn();
    const registry = getJdbcTreeContextMenuRegistry();
    registry.registerContribution({
      id: "test.run",
      label: "Run",
      order: 10,
      matches: () => true,
      run: runFn
    });

    const node = makeNode({ kind: "database", name: "mydb" });
    const items = registry.getItemsForNode(node);
    items[0].onSelect();

    expect(runFn).toHaveBeenCalledTimes(1);
    expect(runFn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "database", name: "mydb" })
    );
  });

  it("supports async contributions", async () => {
    const runFn = vi.fn().mockResolvedValue(undefined);
    const registry = getJdbcTreeContextMenuRegistry();
    registry.registerContribution({
      id: "test.async",
      label: "Async Action",
      order: 10,
      matches: () => true,
      run: runFn
    });

    const items = registry.getItemsForNode(makeNode());
    await items[0].onSelect();

    expect(runFn).toHaveBeenCalledTimes(1);
  });

  it("matches contributions using nodeType predicate", () => {
    const registry = getJdbcTreeContextMenuRegistry();
    registry.registerContribution({
      id: "test.structural",
      label: "Structural Action",
      order: 10,
      matches: (node) => node.nodeType === "structural",
      run: vi.fn()
    });

    const structuralNode = makeNode({ nodeType: "structural" });
    const propertyNode = makeNode({ nodeType: "property", kind: "column" });

    expect(registry.getItemsForNode(structuralNode)).toHaveLength(1);
    expect(registry.getItemsForNode(propertyNode)).toHaveLength(0);
  });

  it("matches contributions using attributes predicate", () => {
    const registry = getJdbcTreeContextMenuRegistry();
    registry.registerContribution({
      id: "test.has-catalog",
      label: "Has Catalog",
      order: 10,
      matches: (node) => typeof node.attributes.catalog === "string",
      run: vi.fn()
    });

    const withCatalog = makeNode({ kind: "schema", attributes: { catalog: "mydb" } });
    const withoutCatalog = makeNode({ kind: "schema", attributes: {} });

    expect(registry.getItemsForNode(withCatalog)).toHaveLength(1);
    expect(registry.getItemsForNode(withoutCatalog)).toHaveLength(0);
  });
});
