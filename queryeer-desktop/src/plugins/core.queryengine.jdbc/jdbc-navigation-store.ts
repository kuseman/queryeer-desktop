import { BackendNotReadyError } from "../../contracts/backend/BackendNotReadyError";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import type {
  JdbcConnectionTreeEntry,
  JdbcSchemaObject,
  JdbcTreeNode,
  NodeType
} from "./jdbc-navigation-types";

type JdbcNavigationStoreState = {
  connectionEntries: JdbcConnectionTreeEntry[];
  nodeMap: Map<string, JdbcTreeNode>;
  linkToActiveFile: boolean;
};

export class JdbcNavigationStore {
  private state: JdbcNavigationStoreState = {
    connectionEntries: [],
    nodeMap: new Map(),
    linkToActiveFile: true
  };
  private listeners = new Set<() => void>();

  reset(): void {
    this.state = { connectionEntries: [], nodeMap: new Map(), linkToActiveFile: true };
    this.listeners.clear();
  }

  loadConnectionRoots(): void {
    const connections = getConfiguredJdbcConnections().filter((c) => c.enabled);
    const newEntries: JdbcConnectionTreeEntry[] = [];
    const newNodeMap = new Map<string, JdbcTreeNode>(this.state.nodeMap);

    for (const conn of connections) {
      const rootNodeId = `${conn.connectionId}::__root__`;
      newEntries.push({
        connectionId: conn.connectionId,
        title: conn.title ?? "Untitled connection",
        dialectId: conn.dialectId,
        rootNodeId
      });
      if (!newNodeMap.has(rootNodeId)) {
        newNodeMap.set(rootNodeId, {
          id: rootNodeId,
          connectionId: conn.connectionId,
          dialectId: conn.dialectId,
          kind: "connection",
          nodeType: "structural",
          name: conn.title ?? "Untitled connection",
          attributes: {},
          isExpanded: false,
          isLoaded: false,
          isLoading: false,
          loadError: undefined,
          childIds: []
        });
      }
    }

    const activeRootIds = new Set(newEntries.map((e) => e.rootNodeId));
    for (const [id, node] of newNodeMap) {
      if (node.kind === "connection" && !activeRootIds.has(id)) {
        this.removeSubtree(id, newNodeMap);
      }
    }

    this.state = { ...this.state, connectionEntries: newEntries, nodeMap: newNodeMap };
    this.notify();
  }

  async expandNode(nodeId: string, options?: { silent?: boolean }): Promise<void> {
    const node = this.state.nodeMap.get(nodeId);
    if (!node) return;
    if (node.isLoaded) {
      this.updateNode(nodeId, { isExpanded: true });
      return;
    }
    if (node.isLoading) return;

    this.updateNode(nodeId, { isLoading: true, loadError: undefined });
    try {
      await this.doFetchAndApply(nodeId, node, options);
    } catch (e) {
      if (e instanceof BackendNotReadyError) {
        this.updateNode(nodeId, { isLoading: false });
        return;
      }
      if (options?.silent) {
        this.updateNode(nodeId, { isLoading: false });
        return;
      }
      const message = e instanceof Error ? e.message : String(e);
      this.updateNode(nodeId, { isLoading: false, loadError: message });
    }
  }

  private async doFetchAndApply(nodeId: string, node: JdbcTreeNode, options?: { silent?: boolean }): Promise<void> {
    const children = await this.fetchChildren(node, options);
    const newNodeMap = new Map(this.state.nodeMap);
    const catalog = node.kind === "database" ? node.name : (node.attributes.catalog as string | undefined);
    const childIds = this.materializeNodes(node.connectionId, node.dialectId, children, newNodeMap, catalog);
    newNodeMap.set(nodeId, {
      ...newNodeMap.get(nodeId)!,
      isLoading: false,
      isLoaded: true,
      isExpanded: true,
      childIds
    });
    this.state = { ...this.state, nodeMap: newNodeMap };
    this.notify();
  }

  collapseNode(nodeId: string): void {
    this.updateNode(nodeId, { isExpanded: false });
  }

  async refreshNode(nodeId: string): Promise<void> {
    const node = this.state.nodeMap.get(nodeId);
    if (!node) return;
    const newNodeMap = new Map(this.state.nodeMap);
    this.removeChildSubtrees(nodeId, newNodeMap);
    newNodeMap.set(nodeId, {
      ...newNodeMap.get(nodeId)!,
      isLoaded: false,
      isExpanded: false,
      childIds: []
    });
    this.state = { ...this.state, nodeMap: newNodeMap };
    await this.expandNode(nodeId);
  }

  toggleLinkToActiveFile(): void {
    this.state = { ...this.state, linkToActiveFile: !this.state.linkToActiveFile };
    this.notify();
  }

  getState(): JdbcNavigationStoreState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getNode(nodeId: string): JdbcTreeNode | undefined {
    return this.state.nodeMap.get(nodeId);
  }

  getChildNodes(nodeId: string): JdbcTreeNode[] {
    const node = this.state.nodeMap.get(nodeId);
    if (!node) return [];
    return node.childIds
      .map((id) => this.state.nodeMap.get(id))
      .filter((n): n is JdbcTreeNode => n !== undefined);
  }

  private async fetchChildren(node: JdbcTreeNode, options?: { silent?: boolean }): Promise<JdbcSchemaObject[]> {
    const service = getQueryEngineService();
    const target = buildTarget(node);
    return (await service.invoke({
      engineId: "jdbc",
      action: "jdbc.schema.fetch",
      payload: {
        connectionId: node.connectionId,
        parentKind: node.kind,
        target: target ?? undefined
      }
    }, { silent: options?.silent })) as JdbcSchemaObject[];
  }

  private materializeNodes(
    connectionId: string,
    dialectId: string,
    objects: JdbcSchemaObject[],
    nodeMap: Map<string, JdbcTreeNode>,
    catalog?: string
  ): string[] {
    const ids: string[] = [];
    for (const obj of objects) {
      const qualifier = catalog ? `${catalog}/` : "";
      const nodeId = `${connectionId}::${qualifier}${obj.id}`;
      const nodeType: NodeType = obj.nodeType ?? inferNodeType(obj.kind);
      const isLeaf = nodeType === "property";
      const hasInlineChildren = (obj.children ?? []).length > 0;
      const children = obj.children ?? [];
      const childIds =
        children.length > 0
          ? this.materializeNodes(connectionId, dialectId, children, nodeMap, catalog)
          : [];
      nodeMap.set(nodeId, {
        id: nodeId,
        connectionId,
        dialectId,
        kind: obj.kind,
        nodeType,
        name: obj.name,
        fullName: obj.fullName,
        attributes: obj.attributes,
        isExpanded: false,
        isLoaded: isLeaf || hasInlineChildren,
        isLoading: false,
        loadError: undefined,
        childIds
      });
      ids.push(nodeId);
    }
    return ids;
  }

  private updateNode(nodeId: string, patch: Partial<JdbcTreeNode>): void {
    const node = this.state.nodeMap.get(nodeId);
    if (!node) return;
    const newNodeMap = new Map(this.state.nodeMap);
    newNodeMap.set(nodeId, { ...node, ...patch });
    this.state = { ...this.state, nodeMap: newNodeMap };
    this.notify();
  }

  private removeSubtree(nodeId: string, nodeMap: Map<string, JdbcTreeNode>): void {
    const node = nodeMap.get(nodeId);
    if (!node) return;
    for (const childId of node.childIds) {
      this.removeSubtree(childId, nodeMap);
    }
    nodeMap.delete(nodeId);
  }

  private removeChildSubtrees(nodeId: string, nodeMap: Map<string, JdbcTreeNode>): void {
    const node = nodeMap.get(nodeId);
    if (!node) return;
    for (const childId of node.childIds) {
      this.removeSubtree(childId, nodeMap);
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function inferNodeType(kind: string): NodeType {
  switch (kind) {
    case "connection":
    case "database":
    case "schema":
      return "structural";
    case "column":
    case "primary_key":
    case "foreign_key":
    case "index":
    case "index_column":
      return "property";
    default:
      if (kind.endsWith("_container")) return "container";
      if (kind.endsWith("_folder")) return "folder";
      return "object";
  }
}

function buildTarget(node: JdbcTreeNode): Record<string, string> | undefined {
  const target: Record<string, string> = {};

  if (node.kind === "database") {
    target.database = node.name;
  } else if (node.kind === "schema") {
    if (node.attributes.catalog) target.database = node.attributes.catalog as string;
    target.schema = node.name;
  } else {
    if (node.attributes.catalog) target.database = node.attributes.catalog as string;
    if (node.attributes.schema) target.schema = node.attributes.schema as string;
  }

  if (node.kind === "table" || node.kind === "view") {
    target.table = node.name;
  }

  if (node.kind === "columns_folder" || node.kind === "indexes_folder") {
    if (node.attributes.table) target.table = node.attributes.table as string;
  }

  return Object.keys(target).length > 0 ? target : undefined;
}

let instance: JdbcNavigationStore | undefined;

export function getJdbcNavigationStore(): JdbcNavigationStore {
  if (!instance) {
    instance = new JdbcNavigationStore();
  }
  return instance;
}
