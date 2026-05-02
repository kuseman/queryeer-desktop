import { getCoreSecurityService } from "../core.security/service";
import { getQueryEngineService } from "../core.queryengine/QueryEngineService";
import { getConfiguredJdbcConnections } from "./jdbc-settings";
import type {
  JdbcConnectionTreeEntry,
  JdbcSchemaObject,
  JdbcTreeNode
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
        title: conn.title ?? conn.connectionId,
        dialectId: conn.dialectId,
        rootNodeId
      });
      if (!newNodeMap.has(rootNodeId)) {
        newNodeMap.set(rootNodeId, {
          id: rootNodeId,
          connectionId: conn.connectionId,
          kind: "connection",
          name: conn.title ?? conn.connectionId,
          attributes: {},
          isExpanded: false,
          isLoaded: false,
          isLoading: false,
          loadError: undefined,
          childIds: []
        });
      }
    }

    // Remove root nodes for connections that are no longer configured
    const activeRootIds = new Set(newEntries.map((e) => e.rootNodeId));
    for (const [id, node] of newNodeMap) {
      if (node.kind === "connection" && !activeRootIds.has(id)) {
        this.removeSubtree(id, newNodeMap);
      }
    }

    this.state = { ...this.state, connectionEntries: newEntries, nodeMap: newNodeMap };
    this.notify();
  }

  async expandNode(nodeId: string): Promise<void> {
    const node = this.state.nodeMap.get(nodeId);
    if (!node) return;
    if (node.isLoaded) {
      this.updateNode(nodeId, { isExpanded: true });
      return;
    }
    if (node.isLoading) return;

    if (node.kind === "database") {
      this.updateNode(nodeId, { isExpanded: true });
      return;
    }

    this.updateNode(nodeId, { isLoading: true, loadError: undefined });
    try {
      await this.doFetchAndApply(nodeId, node);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (isSessionLockedMessage(message)) {
        const unlocked =
          (await getCoreSecurityService()?.ensureUnlockedForSecretAccess({ interactive: true })) ??
          false;
        if (unlocked) {
          this.updateNode(nodeId, { isLoading: true, loadError: undefined });
          try {
            await this.doFetchAndApply(nodeId, node);
          } catch (retryE) {
            this.updateNode(nodeId, {
              isLoading: false,
              loadError: retryE instanceof Error ? retryE.message : String(retryE)
            });
          }
        } else {
          this.updateNode(nodeId, { isLoading: false });
        }
        return;
      }
      this.updateNode(nodeId, { isLoading: false, loadError: message });
    }
  }

  private async doFetchAndApply(nodeId: string, node: JdbcTreeNode): Promise<void> {
    const children = await this.fetchChildren(node);
    const newNodeMap = new Map(this.state.nodeMap);
    const childIds = this.materializeNodes(node.connectionId, children, newNodeMap);
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
    // Remove old children
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

  private async fetchChildren(node: JdbcTreeNode): Promise<JdbcSchemaObject[]> {
    const service = getQueryEngineService();
    if (node.kind === "connection") {
      const connection = getConfiguredJdbcConnections().find((c) => c.connectionId === node.connectionId);
      return (await service.invoke({
        engineId: "jdbc",
        action: "jdbc.schema.fetch",
        payload: {
          connectionId: node.connectionId,
          scope: "top",
          password: connection?.password,
          properties: connection?.properties
        }
      })) as JdbcSchemaObject[];
    }
    if (node.kind === "schema") {
      const connection = getConfiguredJdbcConnections().find((c) => c.connectionId === node.connectionId);
      return (await service.invoke({
        engineId: "jdbc",
        action: "jdbc.schema.fetch",
        payload: {
          connectionId: node.connectionId,
          scope: "tables",
          target: { database: node.attributes.catalog as string, schema: node.name },
          password: connection?.password,
          properties: connection?.properties
        }
      })) as JdbcSchemaObject[];
    }
    if (node.kind === "table" || node.kind === "view") {
      return (await service.invoke({
        engineId: "jdbc",
        action: "jdbc.schema.fetch",
        payload: {
          connectionId: node.connectionId,
          scope: "columns",
          target: {
            database: node.attributes.catalog as string,
            schema: node.attributes.schema as string,
            table: node.name
          }
        }
      })) as JdbcSchemaObject[];
    }
    return [];
  }

  private materializeNodes(
    connectionId: string,
    objects: JdbcSchemaObject[],
    nodeMap: Map<string, JdbcTreeNode>
  ): string[] {
    const ids: string[] = [];
    for (const obj of objects) {
      const nodeId = `${connectionId}::${obj.id}`;
      const isLeaf = obj.kind === "column" || obj.kind === "primary_key" || obj.kind === "foreign_key" || obj.kind === "index";
      const isTableOrView = obj.kind === "table" || obj.kind === "view";
      // database nodes are loaded because their schema children are inline from scope=top
      // schema nodes need a lazy load (tables not included in scope=top)
      const isLoaded = isLeaf || obj.kind === "database";
      const childIds =
        obj.children.length > 0
          ? this.materializeNodes(connectionId, obj.children, nodeMap)
          : [];
      nodeMap.set(nodeId, {
        id: nodeId,
        connectionId,
        kind: obj.kind,
        name: obj.name,
        attributes: obj.attributes,
        isExpanded: false,
        isLoaded: isLoaded || (isTableOrView ? false : childIds.length > 0),
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

let instance: JdbcNavigationStore | undefined;

export function getJdbcNavigationStore(): JdbcNavigationStore {
  if (!instance) {
    instance = new JdbcNavigationStore();
  }
  return instance;
}

function isSessionLockedMessage(message: string): boolean {
  return message.toLowerCase().includes("session is locked");
}
