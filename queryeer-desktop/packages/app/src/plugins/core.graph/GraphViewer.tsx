import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Background, Controls, MarkerType, MiniMap, Position, ReactFlow, getViewportForBounds, Handle, type Edge as FlowEdge, type Node as FlowNode, type Node, type Edge, type NodeTypes, type ReactFlowInstance } from "@xyflow/react";
import type { GraphActionInvocation, GraphDocument, GraphEntity, GraphLayoutDirection, GraphVertex } from "@queryeer/api/graph";
import { ContextMenuSurface } from "../../renderer/components/ContextMenuSurface";
import { dagreGraphLayoutProvider, type GraphLayoutProvider, type PositionedGraphVertex } from "./graph-layout";
import { formatGraphPropertyValue, getGraphEntityActions, getGraphEntityProperties, getImportantProperties, resolveGraphEntity, validateGraphDocument } from "./graph-utils";
import { getGraphNodeTypeRegistry } from "./graph-node-type-registry";
import { getGraphViewState, setGraphViewState } from "./graph-view-state-store";
import { getVisibleVertexIds, hasVisibleVertexEntry, setAllVerticesVisible, subscribeToVisibleVertices } from "./graph-visible-vertices-store";
import "@xyflow/react/dist/style.css";
import "./graph.css";

type GraphInteractionStoreLike = {
  get: (graphId: string) => {
    selection: { type: "vertex" | "edge"; entityId: string } | null;
    highlightedVertexIds: string[];
    highlightedEdgeIds: string[];
  };
  select: (graphId: string, selection: { type: "vertex" | "edge"; entityId: string }) => void;
  clearSelection: (graphId: string) => void;
  subscribe: (listener: () => void) => () => void;
};

type GraphInteractionSnapshot = ReturnType<GraphInteractionStoreLike["get"]>;

const EMPTY_INTERACTION_STATE: GraphInteractionSnapshot = {
  selection: null,
  highlightedVertexIds: [],
  highlightedEdgeIds: []
};

type GraphViewerProps = {
  graph: GraphDocument;
  viewStateKey?: string;
  layoutProvider?: GraphLayoutProvider;
  iconResolver?: (label?: string, kind?: string) => string | undefined;
  interactionStore?: GraphInteractionStoreLike;
  onEntityAction?: (invocation: GraphActionInvocation) => void;
  onSelectionChanged?: (entity: GraphEntity | null) => void;
};

type GraphVertexNodeData = {
  vertex: GraphVertex;
  layoutDirection: GraphLayoutDirection;
  resolvedIconUrl?: string;
  highlighted: boolean;
};

type ContextMenuState = {
  x: number;
  y: number;
  entity: GraphEntity;
};

type TooltipState = {
  x: number;
  y: number;
  entity: GraphEntity;
};

const layoutDirectionOptions: Array<{ value: GraphLayoutDirection; label: string }> = [
  { value: "top-bottom", label: "Top to bottom" },
  { value: "bottom-top", label: "Bottom to top" },
  { value: "left-right", label: "Left to right" },
  { value: "right-left", label: "Right to left" }
];

let defaultNodeTypes: NodeTypes | null = null;
function getDefaultNodeTypes(): NodeTypes {
  if (!defaultNodeTypes) {
    const registry = getGraphNodeTypeRegistry();
    const types: NodeTypes = { default: GraphVertexNode as unknown as NodeTypes[string] };
    for (const [kind, component] of registry.getAll()) {
      types[kind] = component as unknown as NodeTypes[string];
    }
    defaultNodeTypes = types;
  }
  return defaultNodeTypes;
}

export function GraphViewer({
  graph,
  viewStateKey,
  layoutProvider = dagreGraphLayoutProvider,
  iconResolver,
  interactionStore,
  onEntityAction,
  onSelectionChanged
}: GraphViewerProps): JSX.Element {
  const graphViewStateKey = viewStateKey ?? graph.id;
  const validation = useMemo(() => validateGraphDocument(graph), [graph]);
  const externalInteraction = useInteractionState(graph.id, interactionStore);
  const [localSelection, setLocalSelection] = useState<GraphInteractionSnapshot["selection"]>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [layoutDirectionOverride, setLayoutDirectionOverride] = useState<GraphLayoutDirection | "auto">(
    () => getGraphViewState(graphViewStateKey)?.layoutDirection ?? "auto"
  );
  const [, forceRender] = useState(0);
  useEffect(() => subscribeToVisibleVertices(() => forceRender((n) => n + 1)), []);
  // Synchronously initialize the store if it's empty so the first render
  // already sees the full vertex set; no flash, no race with the sidebar panel.
  if (!hasVisibleVertexEntry(graphViewStateKey) && graph.vertices.length > 0) {
    setAllVerticesVisible(graphViewStateKey, graph.vertices.map((v) => v.id), true);
  }
  const visibleVertexIds = getVisibleVertexIds(graphViewStateKey);
  const expandedVertexIds = useMemo(() => {
    if (visibleVertexIds.size === 0) return visibleVertexIds;
    const expanded = new Set(visibleVertexIds);
    for (const edge of graph.edges) {
      if (visibleVertexIds.has(edge.sourceVertexId)) expanded.add(edge.targetVertexId);
      if (visibleVertexIds.has(edge.targetVertexId)) expanded.add(edge.sourceVertexId);
    }
    return expanded;
  }, [visibleVertexIds, graph.edges]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const graphIdRef = useRef(graphViewStateKey);
  const layoutDirectionRef = useRef(layoutDirectionOverride);
  const latestViewportRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 });
  const rfInstanceRef = useRef<ReactFlowInstance<Node<GraphVertexNodeData>, Edge> | null>(null);
  const viewportAppliedRef = useRef(false);
  const applyingViewportRef = useRef(false);

  // Keep layoutDirectionRef in sync during render (graphIdRef is updated in effect to avoid
  // breaking the save-on-switch guard)
  layoutDirectionRef.current = layoutDirectionOverride;

  const fitViewKeyRef = useRef(0);
  useEffect(() => {
    if (fitViewKeyRef.current > 0) {
      rfInstanceRef.current?.fitView({ duration: 200 });
    }
    fitViewKeyRef.current++;
  }, [expandedVertexIds]);

  const interaction = interactionStore
    ? externalInteraction
    : {
      ...EMPTY_INTERACTION_STATE,
      selection: localSelection
    };
  const highlightedVertexIds = useMemo(
    () => new Set(interaction.highlightedVertexIds),
    [interaction.highlightedVertexIds]
  );
  const highlightedEdgeIds = useMemo(
    () => new Set(interaction.highlightedEdgeIds),
    [interaction.highlightedEdgeIds]
  );
  const selectedEntity = useMemo(() => {
    if (!interaction.selection) {
      return null;
    }
    return resolveGraphEntity(graph, interaction.selection.type, interaction.selection.entityId);
  }, [graph, interaction.selection]);
  const effectiveLayoutDirection = layoutDirectionOverride === "auto"
    ? graph.layout?.direction ?? "top-bottom"
    : layoutDirectionOverride;

  const nodeTypes = getDefaultNodeTypes();

  const visibleGraph = useMemo<GraphDocument>(() => {
    const visibleEdges = graph.edges.filter(
      (e) => expandedVertexIds.has(e.sourceVertexId) && expandedVertexIds.has(e.targetVertexId)
    );
    return {
      ...graph,
      vertices: graph.vertices.filter((v) => expandedVertexIds.has(v.id)),
      edges: visibleEdges,
    };
  }, [graph, expandedVertexIds]);

  const graphWithLayoutOverride = useMemo<GraphDocument>(() => {
    if (layoutDirectionOverride === "auto") {
      return visibleGraph;
    }
    return {
      ...visibleGraph,
      layout: {
        ...visibleGraph.layout,
        direction: layoutDirectionOverride
      }
    };
  }, [visibleGraph, layoutDirectionOverride]);

  const positionedGraph = useMemo(() => layoutProvider.layout(graphWithLayoutOverride), [graphWithLayoutOverride, layoutProvider]);

  const defaultViewport = useMemo(
    () => getGraphViewState(graphViewStateKey)?.viewport ?? { x: 0, y: 0, zoom: 1 },
    [graphViewStateKey]
  );

  const nodes = useMemo<Array<FlowNode<GraphVertexNodeData>>>(() => {
    const registry = getGraphNodeTypeRegistry();
    return positionedGraph.vertices.map((vertex) => ({
    id: vertex.id,
    type: registry.getComponent(vertex.kind ?? "") ? vertex.kind! : "default",
    position: vertex.position,
    selected: selectedEntity?.type === "vertex" && selectedEntity.entity.id === vertex.id,
    data: {
      vertex,
      layoutDirection: effectiveLayoutDirection,
      resolvedIconUrl: iconResolver?.(vertex.label, vertex.kind),
      highlighted: highlightedVertexIds.has(vertex.id)
    },
    style: {
      width: vertex.style?.width ?? 180,
      height: vertex.style?.height ?? 72
    }
  }));
}, [effectiveLayoutDirection, highlightedVertexIds, iconResolver, positionedGraph, selectedEntity]);

  const edges = useMemo<FlowEdge[]>(() => {
    const vertexMap = new Map(graph.vertices.map((v) => [v.id, v]));
    return positionedGraph.edges.map((edge) => {
      const selected = selectedEntity?.type === "edge" && selectedEntity.entity.id === edge.id;
      const highlighted = highlightedEdgeIds.has(edge.id);
      const className = [
        selected ? "is-selected" : "",
        highlighted ? "is-highlighted" : ""
      ].filter(Boolean).join(" ");
      const edgeColor = selected
        ? "var(--accent-muted)"
        : highlighted
          ? "var(--accent)"
          : edge.style?.color;

      let sourceHandle: string | undefined;
      let targetHandle: string | undefined;
      if (edge.kind === "fk" && edge.label) {
        sourceHandle = "fk:" + edge.label;
        const targetVertex = vertexMap.get(edge.targetVertexId);
        if (targetVertex) {
          const columnsGroup = targetVertex.properties?.find((g) => g.id === "columns");
          const pkCol = columnsGroup?.properties.find((p) => p.important === true);
          if (pkCol) {
            targetHandle = "pk:" + pkCol.label;
          }
        }
      }

      return {
        id: edge.id,
        source: edge.sourceVertexId,
        target: edge.targetVertexId,
        sourceHandle,
        targetHandle,
        label: edge.label,
        type: edge.style?.shape === "bezier" ? "default" : edge.style?.shape,
        selected,
        className: className.length > 0 ? className : undefined,
        markerEnd: edge.style?.markerEnd === "none" ? undefined : {
          type: MarkerType.ArrowClosed,
          color: edgeColor
        },
        style: {
          stroke: edgeColor,
          strokeWidth: selected
            ? Math.max((edge.style?.width ?? 2) + 1, 3)
            : highlighted
              ? Math.max(edge.style?.width ?? 2, 3)
              : edge.style?.width,
          strokeDasharray: edge.style?.dash ? "6 4" : undefined
        }
      };
    });
  }, [graph.vertices, highlightedEdgeIds, selectedEntity, positionedGraph.edges]);

  useEffect(() => {
    onSelectionChanged?.(selectedEntity);
  }, [onSelectionChanged, selectedEntity]);

  useEffect(() => {
    if (interaction.selection && !selectedEntity) {
      if (interactionStore) {
        interactionStore.clearSelection(graph.id);
      } else {
        setLocalSelection(null);
      }
    }
  }, [graph.id, interaction.selection, interactionStore, selectedEntity]);

  useEffect(() => {
    if (interactionStore) {
      return;
    }
    setLocalSelection(null);
  }, [graph.id, interactionStore]);

  const selectEntity = (entity: GraphEntity | null): void => {
    if (!interactionStore) {
      setLocalSelection(entity
        ? {
          type: entity.type,
          entityId: entity.entity.id
        }
        : null);
      return;
    }
    if (!entity) {
      interactionStore.clearSelection(graph.id);
      return;
    }
    interactionStore.select(graph.id, {
      type: entity.type,
      entityId: entity.entity.id
    });
  };

  // View state persistence

  const handleMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
    if (!viewportAppliedRef.current || applyingViewportRef.current) {
      return;
    }
    latestViewportRef.current = viewport;
    setGraphViewState(graphIdRef.current, {
      viewport,
      layoutDirection: layoutDirectionRef.current,
    });
  }, []);

  useEffect(() => {
    // graphIdRef.current is the previous graph's id (not overwritten during render)
    const prevId = graphIdRef.current;
    if (prevId !== graphViewStateKey) {
      if (viewportAppliedRef.current) {
        setGraphViewState(prevId, {
          viewport: latestViewportRef.current,
          layoutDirection: layoutDirectionRef.current,
        });
      }
      viewportAppliedRef.current = false;
      graphIdRef.current = graphViewStateKey;
      const saved = getGraphViewState(graphViewStateKey);
      setLayoutDirectionOverride(saved?.layoutDirection ?? "auto");
    }
  }, [graphViewStateKey]);

  useEffect(() => {
    return () => {
      if (viewportAppliedRef.current) {
        setGraphViewState(graphIdRef.current, {
          viewport: latestViewportRef.current,
          layoutDirection: layoutDirectionRef.current,
        });
      }
    };
  }, []);

  const applyViewport = useCallback((instance: ReactFlowInstance<Node<GraphVertexNodeData>, Edge>) => {
    const saved = getGraphViewState(graphViewStateKey);
    if (saved && saved.layoutDirection === layoutDirectionRef.current) {
      latestViewportRef.current = saved.viewport;
      viewportAppliedRef.current = true;
      applyingViewportRef.current = true;
      instance.setViewport(saved.viewport, { duration: 0 });
      requestAnimationFrame(() => { applyingViewportRef.current = false; });
      return;
    }
    const bounds = getGraphBounds(positionedGraph.vertices);
    if (!bounds) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const vp = getViewportForBounds(bounds, rect.width, rect.height, 0.1, 2.5, 0.18);
    latestViewportRef.current = vp;
    viewportAppliedRef.current = true;
    applyingViewportRef.current = true;
    instance.setViewport(vp, { duration: 0 });
    setGraphViewState(graphViewStateKey, { viewport: vp, layoutDirection: layoutDirectionRef.current });
    requestAnimationFrame(() => { applyingViewportRef.current = false; });
  }, [graphViewStateKey, positionedGraph.vertices]);

  useLayoutEffect(() => {
    viewportAppliedRef.current = false;
    const instance = rfInstanceRef.current;
    if (instance) applyViewport(instance);
  }, [applyViewport]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const observer = new ResizeObserver(() => {
      const instance = rfInstanceRef.current;
      if (instance && !viewportAppliedRef.current) {
        applyViewport(instance);
      }
    });
    observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [applyViewport]);

  if (!validation.valid) {
    return (
      <div className="graph-viewer graph-viewer-invalid">
        <h3>Invalid graph document</h3>
        <ul>
          {validation.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      </div>
    );
  }

  return (
    <div className={`graph-viewer${interactionStore ? " has-interaction-store" : ""}`} data-output-focus-target="true" tabIndex={-1}>
      <div className="graph-canvas" ref={canvasRef}>
        <GraphLayoutToolbar
          direction={layoutDirectionOverride}
          onDirectionChanged={setLayoutDirectionOverride}
        />
        <ReactFlow
          key={graphViewStateKey}
          defaultViewport={defaultViewport}
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          proOptions={{ hideAttribution: true }}
          minZoom={0.1}
          maxZoom={2.5}
          panOnScroll
          panActivationKeyCode=""
          onInit={(instance) => { rfInstanceRef.current = instance; applyViewport(instance); }}
          onPaneClick={() => selectEntity(null)}
          onNodeClick={(_event, node) => selectEntity(resolveGraphEntity(graph, "vertex", node.id))}
          onEdgeClick={(_event, edge) => selectEntity(resolveGraphEntity(graph, "edge", edge.id))}
          onNodeContextMenu={(event, node) => openEntityContextMenu(event, resolveGraphEntity(graph, "vertex", node.id), setContextMenu, Boolean(onEntityAction))}
          onEdgeContextMenu={(event, edge) => openEntityContextMenu(event, resolveGraphEntity(graph, "edge", edge.id), setContextMenu, Boolean(onEntityAction))}
          onNodeMouseEnter={(event, node) => openTooltip(event, resolveGraphEntity(graph, "vertex", node.id), setTooltip)}
          onEdgeMouseEnter={(event, edge) => openTooltip(event, resolveGraphEntity(graph, "edge", edge.id), setTooltip)}
          onNodeMouseLeave={() => setTooltip(null)}
          onEdgeMouseLeave={() => setTooltip(null)}
          onMoveEnd={handleMoveEnd}
        >
          <Background />
          <MiniMap
            style={{
              width: 100,  // Half the default size
              height: 75,
            }}
            pannable
            zoomable
            className="graph-minimap"
            nodeColor="var(--bg-2)"
            nodeStrokeColor="var(--border)"
            maskColor="rgba(127, 127, 127, 0.18)"
          />
          <Controls />
        </ReactFlow>
      </div>
      <GraphPropertiesPanel entity={selectedEntity} />
      {tooltip && <GraphTooltip state={tooltip} />}
      {contextMenu && (
        <ContextMenuSurface
          x={contextMenu.x}
          y={contextMenu.y}
          sections={[
            getGraphEntityActions(contextMenu.entity).map((action) => ({
              id: action.id,
              label: action.label,
              disabled: action.disabled,
              onSelect: () => onEntityAction?.({
                graphId: graph.id,
                entityType: contextMenu.entity.type,
                entityId: contextMenu.entity.entity.id,
                actionId: action.id
              })
            }))
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

function getGraphBounds(vertices: PositionedGraphVertex[]): { x: number; y: number; width: number; height: number } | undefined {
  if (vertices.length === 0) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const vertex of vertices) {
    const w = vertex.style?.width ?? 180;
    const h = vertex.style?.height ?? 72;
    const x = vertex.position?.x ?? 0;
    const y = vertex.position?.y ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    const rx = x + w;
    const by = y + h;
    if (rx > maxX) maxX = rx;
    if (by > maxY) maxY = by;
  }
  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  return bounds.width > 0 && bounds.height > 0 ? bounds : undefined;
}

function GraphLayoutToolbar({
  direction,
  onDirectionChanged
}: {
  direction: GraphLayoutDirection | "auto";
  onDirectionChanged: (direction: GraphLayoutDirection | "auto") => void;
}): JSX.Element {
  return (
    <div className="graph-layout-toolbar">
      <label className="graph-layout-label" htmlFor="graph-layout-direction">Layout</label>
      <select
        id="graph-layout-direction"
        className="graph-layout-select"
        value={direction}
        onChange={(event) => onDirectionChanged(event.target.value as GraphLayoutDirection | "auto")}
      >
        <option value="auto">Auto</option>
        {layoutDirectionOptions.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

function GraphVertexNode({ data, selected }: { data: GraphVertexNodeData; selected?: boolean }): JSX.Element {
  const vertex = data.vertex;
  const style = vertex.style ?? {};
  const handles = getHandlePositions(data.layoutDirection);
  const iconUrl = style.iconUrl ?? style.imageUrl ?? data.resolvedIconUrl;
  const className = [
    "graph-node",
    `graph-node-${style.shape ?? "rounded"}`,
    data.highlighted ? "is-highlighted" : "",
    selected ? "is-selected" : ""
  ].filter(Boolean).join(" ");

  return (
    <div
      className={className}
      style={{
        color: style.color,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor
      }}
    >
      <Handle type="target" position={handles.target} className="graph-node-handle" />
      <Handle type="source" position={handles.source} className="graph-node-handle" />
      {iconUrl && <img src={iconUrl} alt="" className="graph-node-icon" aria-hidden="true" />}
      {vertex.overlays && vertex.overlays.length > 0 && (
        <div className="graph-node-overlays" aria-hidden="true">
          {vertex.overlays.map((overlay) => (
            <span
              key={overlay.id}
              className={`graph-node-overlay graph-node-overlay-${overlay.kind}`}
              title={overlay.title ?? overlay.label}
            >
              {overlay.iconUrl
                ? <img src={overlay.iconUrl} alt="" />
                : overlay.kind === "parallel"
                  ? ">>"
                  : overlay.kind === "warning"
                    ? "!"
                    : "i"}
            </span>
          ))}
        </div>
      )}
      <div className="graph-node-body">
        {vertex.kind && <div className="graph-node-kind">{vertex.kind}</div>}
        <div className="graph-node-label">{vertex.label}</div>
        {vertex.description && <div className="graph-node-description">{vertex.description}</div>}
      </div>
    </div>
  );
}

function useInteractionState(
  graphId: string,
  interactionStore: GraphInteractionStoreLike | undefined
): GraphInteractionSnapshot {
  return useSyncExternalStore(
    (listener) => interactionStore?.subscribe(listener) ?? (() => {}),
    () => interactionStore?.get(graphId) ?? EMPTY_INTERACTION_STATE,
    () => interactionStore?.get(graphId) ?? EMPTY_INTERACTION_STATE
  );
}

function getHandlePositions(direction: GraphLayoutDirection): { source: Position; target: Position } {
  switch (direction) {
    case "bottom-top":
      return { source: Position.Top, target: Position.Bottom };
    case "left-right":
      return { source: Position.Right, target: Position.Left };
    case "right-left":
      return { source: Position.Left, target: Position.Right };
    case "top-bottom":
    default:
      return { source: Position.Bottom, target: Position.Top };
  }
}

function GraphTooltip({ state }: { state: TooltipState }): JSX.Element | null {
  const properties = getImportantProperties(getGraphEntityProperties(state.entity));
  if (properties.length === 0) {
    return null;
  }

  return (
    <div className="graph-tooltip" style={{ left: state.x + 10, top: state.y + 10 }}>
      {properties.map((property) => (
        <div key={property.id} className="graph-tooltip-row">
          <span className="graph-tooltip-label">{property.label}</span>
          <span className="graph-tooltip-value">{formatGraphPropertyValue(property)}</span>
        </div>
      ))}
    </div>
  );
}

function GraphPropertiesPanel({ entity }: { entity: GraphEntity | null }): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [width, setWidth] = useState(300);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const groups = getGraphEntityProperties(entity);

  useEffect(() => {
    setCollapsedGroups({});
  }, [entity?.type, entity?.entity.id]);

  const startResize = (event: React.MouseEvent): void => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: MouseEvent): void => {
      setWidth(Math.min(560, Math.max(220, startWidth + startX - moveEvent.clientX)));
    };
    const onUp = (): void => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (collapsed) {
    return (
      <button type="button" className="graph-properties-toggle" onClick={() => setCollapsed(false)}>
        Properties
      </button>
    );
  }

  return (
    <aside className="graph-properties" style={{ width }}>
      <div className="graph-properties-resizer" onMouseDown={startResize} />
      <header className="graph-properties-header">
        <div>
          <div className="graph-properties-title">Properties</div>
          <div className="graph-properties-subtitle">{entity ? entity.entity.id : "No selection"}</div>
        </div>
        <button type="button" className="graph-properties-collapse" onClick={() => setCollapsed(true)}>×</button>
      </header>
      {groups.length === 0 ? (
        <div className="graph-properties-empty">Select a vertex or edge to inspect properties.</div>
      ) : (
        <div className="graph-properties-groups">
          {groups.map((group) => (
            <section key={group.id} className="graph-properties-group">
              <button
                type="button"
                className="graph-properties-group-header"
                aria-expanded={!collapsedGroups[group.id]}
                onClick={() => setCollapsedGroups((current) => ({ ...current, [group.id]: !current[group.id] }))}
              >
                <span className="graph-properties-group-caret" aria-hidden="true">v</span>
                <span>{group.label}</span>
                <span className="graph-properties-group-count">{group.properties.length}</span>
              </button>
              {!collapsedGroups[group.id] && group.properties.map((property) => (
                <div key={property.id} className="graph-properties-row">
                  <span className="graph-properties-label">{property.label}</span>
                  <span className="graph-properties-value">{formatGraphPropertyValue(property)}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}

function openEntityContextMenu(
  event: React.MouseEvent,
  entity: GraphEntity | null,
  setContextMenu: (state: ContextMenuState | null) => void,
  canInvokeActions: boolean
): void {
  if (!canInvokeActions || !entity || getGraphEntityActions(entity).length === 0) {
    return;
  }
  event.preventDefault();
  setContextMenu({ x: event.clientX, y: event.clientY, entity });
}

function openTooltip(
  event: React.MouseEvent,
  entity: GraphEntity | null,
  setTooltip: (state: TooltipState | null) => void
): void {
  if (!entity) {
    setTooltip(null);
    return;
  }
  setTooltip({ x: event.clientX, y: event.clientY, entity });
}
