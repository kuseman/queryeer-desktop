import { useCallback, useEffect, useRef, useState } from "react";
import type { JdbcNavigationStore } from "./jdbc-navigation-store";
import { getBackendStatusService } from "../../renderer/shell/backend-status-service";
import { getNodeIcon } from "./jdbc-tree-contribution";
import type { JdbcTreeNode } from "./jdbc-navigation-types";
import { getJdbcTreeContextMenuRegistry } from "./jdbc-tree-context-menu-registry";
import { ContextMenuSurface } from "../../renderer/components/ContextMenuSurface";
import type { ContextMenuSurfaceItem } from "../../renderer/components/ContextMenuSurface";

type Props = {
  store: JdbcNavigationStore;
  activeFileConnectionId: string | undefined;
  activeFileDatabase: string | undefined;
};

export function JdbcNavigationTree({ store, activeFileConnectionId, activeFileDatabase }: Props) {
  const [, setRevision] = useState(0);
  const prevBackendStateRef = useRef<string | null>(null);
  const treeBodyRef = useRef<HTMLDivElement | null>(null);

  const scrollToActiveNode = useCallback(() => {
    if (!treeBodyRef.current) return;
    // Scroll to the deepest active node (database, not the parent connection)
    const allActive = treeBodyRef.current.querySelectorAll<HTMLElement>(".jdbc-nav-node.is-active");
    if (allActive.length > 0) {
      allActive[allActive.length - 1].scrollIntoView({ block: "nearest" });
    }
  }, []);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: JdbcTreeNode;
  } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, node: JdbcTreeNode) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  useEffect(() => {
    return store.subscribe(() => setRevision((r) => r + 1));
  }, [store]);

  // Auto-expand to active file connection when linkToActiveFile is on
  useEffect(() => {
    if (!store.getState().linkToActiveFile || !activeFileConnectionId) return;
    const rootNodeId = `${activeFileConnectionId}::__root__`;
    void store.expandNode(rootNodeId, { silent: true }).then(() => {
      requestAnimationFrame(() => scrollToActiveNode());
    });
  }, [store, activeFileConnectionId, scrollToActiveNode]);

  // Auto-expand databases_container then target database
  useEffect(() => {
    if (!store.getState().linkToActiveFile || !activeFileConnectionId || !activeFileDatabase) return;
    const rootNode = store.getNode(`${activeFileConnectionId}::__root__`);
    if (!rootNode?.isLoaded) return;

    const databasesNode = rootNode.childIds
      .map((id) => store.getNode(id))
      .find((n) => n?.kind === "databases_container");
    if (!databasesNode) return;

    if (!databasesNode.isLoaded) {
      void store.expandNode(databasesNode.id, { silent: true }).then(() => {
        const refreshed = store.getNode(databasesNode.id);
        if (!refreshed?.isLoaded) return;
        for (const dbId of refreshed.childIds) {
          const db = store.getNode(dbId);
          if (db?.name === activeFileDatabase) {
            void store.expandNode(dbId, { silent: true }).then(() => {
              requestAnimationFrame(() => scrollToActiveNode());
            });
            break;
          }
        }
      });
      return;
    }

    for (const dbId of databasesNode.childIds) {
      const db = store.getNode(dbId);
      if (db?.name === activeFileDatabase) {
        void store.expandNode(dbId, { silent: true }).then(() => {
          requestAnimationFrame(() => scrollToActiveNode());
        });
        break;
      }
    }
  }, [store, activeFileConnectionId, activeFileDatabase, scrollToActiveNode]);

  // Auto-recover: re-expand active connection/database when backend becomes healthy
  useEffect(() => {
    const service = getBackendStatusService();
    return service.subscribe((status) => {
      if (
        status.state === "healthy"
        && prevBackendStateRef.current !== "healthy"
        && store.getState().linkToActiveFile
        && activeFileConnectionId
      ) {
        const rootNodeId = `${activeFileConnectionId}::__root__`;
        void store.expandNode(rootNodeId, { silent: true }).then(() => {
          requestAnimationFrame(() => scrollToActiveNode());
        });
      }
      prevBackendStateRef.current = status.state;
    });
  }, [store, activeFileConnectionId, activeFileDatabase, scrollToActiveNode]);

  const state = store.getState();

  const handleNodeClick = (nodeId: string) => {
    const node = store.getNode(nodeId);
    if (!node) return;
    if (node.isExpanded) {
      store.collapseNode(nodeId);
    } else {
      void store.expandNode(nodeId);
    }
  };

  return (
    <div className="jdbc-nav-tree">
      <div className="jdbc-nav-tree-header">
        <button
          className="jdbc-nav-link-toggle"
          title={state.linkToActiveFile ? "Unlink from active file" : "Link to active file"}
          onClick={() => store.toggleLinkToActiveFile()}
        >
          {state.linkToActiveFile ? "⊟" : "⊞"}
        </button>
      </div>
      <div ref={treeBodyRef} className="jdbc-nav-tree-body">
        {state.connectionEntries.map((entry) => (
          <TreeNodeRow
            key={entry.rootNodeId}
            nodeId={entry.rootNodeId}
            store={store}
            depth={0}
            dialectId={entry.dialectId}
            activeFileConnectionId={activeFileConnectionId}
            activeFileDatabase={activeFileDatabase}
            onNodeClick={handleNodeClick}
            onContextMenu={handleContextMenu}
          />
        ))}
      </div>
      {contextMenu && (() => {
        const registry = getJdbcTreeContextMenuRegistry();
        const menuItems = registry.getItemsForNode(contextMenu.node);
        if (menuItems.length === 0) return null;
        const sections = groupBySection(menuItems);
        return (
          <ContextMenuSurface
            x={contextMenu.x}
            y={contextMenu.y}
            sections={sections}
            onClose={() => setContextMenu(null)}
          />
        );
      })()}
    </div>
  );
}

type NodeRowProps = {
  nodeId: string;
  store: JdbcNavigationStore;
  depth: number;
  dialectId: string;
  activeFileConnectionId: string | undefined;
  activeFileDatabase: string | undefined;
  onNodeClick: (nodeId: string) => void;
  onContextMenu: (e: React.MouseEvent, node: JdbcTreeNode) => void;
};

function TreeNodeRow({ nodeId, store, depth, dialectId, activeFileConnectionId, activeFileDatabase, onNodeClick, onContextMenu }: NodeRowProps) {
  const node = store.getNode(nodeId);
  if (!node) return null;

  // Property nodes are always leaf. Other nodes are expandable only if they
  // have children or may have children (not yet loaded, or loaded with children).
  const isExpandable = node.nodeType !== "property" && (node.isLoading || !node.isLoaded || node.childIds.length > 0);
  const chevron = isExpandable ? (node.isExpanded ? "▼" : "▶") : "  ";
  const icon = getNodeIcon(node.kind, node.attributes, dialectId);
  const label = formatNodeLabel(node);

  const isActive =
    activeFileConnectionId && node.connectionId === activeFileConnectionId
      ? node.kind === "connection"
        ? true
        : node.kind === "database" && node.name === activeFileDatabase
      : false;

  const classNames = `jdbc-nav-node${node.isLoading ? " is-loading" : ""}${node.loadError ? " has-error" : ""}${isActive ? " is-active" : ""}`;

  return (
    <>
      <div
        data-testid="jdbc-tree-node"
        className={classNames}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => isExpandable && onNodeClick(nodeId)}
        onContextMenu={(e) => onContextMenu(e, node)}
        role="treeitem"
        aria-expanded={node.isExpanded}
      >
        <span className="jdbc-nav-node-chevron">{chevron}</span>
        <span className="jdbc-nav-node-icon">{icon}</span>
        <span className="jdbc-nav-node-name">
          <span className={`jdbc-nav-node-label jdbc-nav-label-${node.nodeType}`}>{label}</span>
        </span>
        {node.isLoading && (
          <span data-testid="jdbc-tree-loading" className="jdbc-nav-node-loading">
            <span className="jdbc-nav-node-spinner" />
          </span>
        )}
        {node.loadError && (
          <span className="jdbc-nav-node-error" title={node.loadError}>⚠</span>
        )}
      </div>
      {node.isExpanded && node.childIds.map((childId) => (
        <TreeNodeRow
          key={childId}
          nodeId={childId}
          store={store}
          depth={depth + 1}
          dialectId={dialectId}
          activeFileConnectionId={activeFileConnectionId}
          activeFileDatabase={activeFileDatabase}
          onNodeClick={onNodeClick}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  );
}

function formatNodeLabel(node: JdbcTreeNode): string {
  if (node.nodeType === "object" && node.fullName && node.fullName !== node.name) {
    return node.fullName;
  }
  if (node.kind !== "column") {
    return node.name;
  }
  // Inline constraint indicators
  const icons: string[] = [];
  if (node.attributes.primaryKey) icons.push("🔑");
  if (node.attributes.foreignKey) icons.push("⇒");
  const iconStr = icons.length > 0 ? ` ${icons.join("")}` : "";
  // FK reference annotation:  → schema.table(column)
  const fkRef =
    node.attributes.foreignKey && typeof node.attributes.referencesTable === "string"
      ? `\u00a0→\u00a0${node.attributes.referencesTable}${typeof node.attributes.referencesColumn === "string" ? `(${node.attributes.referencesColumn})` : ""}`
      : "";
  const type = typeof node.attributes.type === "string" ? node.attributes.type : "unknown";
  const size = typeof node.attributes.size === "number" ? node.attributes.size : undefined;
  const precision = typeof node.attributes.precision === "number" ? node.attributes.precision : undefined;
  const scale = typeof node.attributes.scale === "number" ? node.attributes.scale : undefined;
  const qualifiedType = formatQualifiedType(type, size, precision, scale);
  const nullableRaw = typeof node.attributes.nullable === "string" ? node.attributes.nullable.trim().toLowerCase() : "";
  const nullable = nullableRaw === "no" || nullableRaw === "false" || nullableRaw === "not null" ? "not null" : "null";
  return `${node.name}${iconStr}${fkRef} ${qualifiedType} ${nullable}`;
}

function formatQualifiedType(type: string, size?: number, precision?: number, scale?: number): string {
  const t = type.toLowerCase();
  const isNumeric = t === "decimal" || t === "numeric";
  const isSized = t.includes("char") || t.includes("binary");

  if (isNumeric && precision !== undefined && precision > 0) {
    if (scale !== undefined && scale > 0) {
      return `${type}(${precision},${scale})`;
    }
    return `${type}(${precision})`;
  }

  if (isSized && size !== undefined) {
    if (size < 0) {
      return `${type}(max)`;
    }
    if (size > 0) {
      return `${type}(${size})`;
    }
  }

  return type;
}

function groupBySection(
  items: Array<{ id: string; label: string; section?: string; onSelect: () => void | Promise<void> }>
): ContextMenuSurfaceItem[][] {
  const map = new Map<string, ContextMenuSurfaceItem[]>();
  for (const item of items) {
    const section = item.section ?? "";
    if (!map.has(section)) {
      map.set(section, []);
    }
    map.get(section)!.push({
      id: item.id,
      label: item.label,
      onSelect: item.onSelect
    });
  }
  return Array.from(map.values());
}
