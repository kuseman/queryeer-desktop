import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeTypes
} from "@xyflow/react";
import type { GraphActionInvocation, GraphDocument, GraphEntity, GraphLayoutDirection, GraphVertex } from "../../contracts/graph";
import { ContextMenuSurface } from "../../renderer/components/ContextMenuSurface";
import { dagreGraphLayoutProvider, type GraphLayoutProvider } from "./graph-layout";
import { formatGraphPropertyValue, getGraphEntityActions, getGraphEntityProperties, getImportantProperties, resolveGraphEntity, validateGraphDocument } from "./graph-utils";
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

const nodeTypes: NodeTypes = {
  graphVertex: GraphVertexNode as unknown as NodeTypes[string]
};

const layoutDirectionOptions: Array<{ value: GraphLayoutDirection; label: string }> = [
  { value: "top-bottom", label: "Top to bottom" },
  { value: "bottom-top", label: "Bottom to top" },
  { value: "left-right", label: "Left to right" },
  { value: "right-left", label: "Right to left" }
];

export function GraphViewer({
  graph,
  layoutProvider = dagreGraphLayoutProvider,
  iconResolver,
  interactionStore,
  onEntityAction,
  onSelectionChanged
}: GraphViewerProps): JSX.Element {
  const validation = useMemo(() => validateGraphDocument(graph), [graph]);
  const externalInteraction = useInteractionState(graph.id, interactionStore);
  const [localSelection, setLocalSelection] = useState<GraphInteractionSnapshot["selection"]>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [layoutDirectionOverride, setLayoutDirectionOverride] = useState<GraphLayoutDirection | "auto">("auto");
  const canvasRef = useRef<HTMLDivElement | null>(null);
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

  const graphWithLayoutOverride = useMemo<GraphDocument>(() => {
    if (layoutDirectionOverride === "auto") {
      return graph;
    }
    return {
      ...graph,
      layout: {
        ...graph.layout,
        direction: layoutDirectionOverride
      }
    };
  }, [graph, layoutDirectionOverride]);

  const positionedGraph = useMemo(() => layoutProvider.layout(graphWithLayoutOverride), [graphWithLayoutOverride, layoutProvider]);

  const nodes = useMemo<Array<FlowNode<GraphVertexNodeData>>>(() => positionedGraph.vertices.map((vertex) => ({
    id: vertex.id,
    type: "graphVertex",
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
  })), [effectiveLayoutDirection, highlightedVertexIds, iconResolver, positionedGraph, selectedEntity]);

  const edges = useMemo<FlowEdge[]>(() => graph.edges.map((edge) => {
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
    return {
      id: edge.id,
      source: edge.sourceVertexId,
      target: edge.targetVertexId,
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
  }), [graph.edges, highlightedEdgeIds, selectedEntity]);

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
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          proOptions={{ hideAttribution: true }}
          fitView
          minZoom={0.1}
          maxZoom={2.5}
          panOnScroll
          onPaneClick={() => selectEntity(null)}
          onNodeClick={(_event, node) => selectEntity(resolveGraphEntity(graph, "vertex", node.id))}
          onEdgeClick={(_event, edge) => selectEntity(resolveGraphEntity(graph, "edge", edge.id))}
          onNodeContextMenu={(event, node) => openEntityContextMenu(event, resolveGraphEntity(graph, "vertex", node.id), setContextMenu, Boolean(onEntityAction))}
          onEdgeContextMenu={(event, edge) => openEntityContextMenu(event, resolveGraphEntity(graph, "edge", edge.id), setContextMenu, Boolean(onEntityAction))}
          onNodeMouseEnter={(event, node) => openTooltip(event, resolveGraphEntity(graph, "vertex", node.id), setTooltip)}
          onEdgeMouseEnter={(event, edge) => openTooltip(event, resolveGraphEntity(graph, "edge", edge.id), setTooltip)}
          onNodeMouseLeave={() => setTooltip(null)}
          onEdgeMouseLeave={() => setTooltip(null)}
        >
          <GraphFitController
            canvasRef={canvasRef}
            fitKey={`${graph.id}:${nodes.length}:${edges.length}:${effectiveLayoutDirection}`}
          />
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

function GraphFitController({
  canvasRef,
  fitKey
}: {
  canvasRef: RefObject<HTMLDivElement>;
  fitKey: string;
}): null {
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (!nodesInitialized) {
      return;
    }
    const fit = () => {
      void fitView({ padding: 0.18, duration: 0, includeHiddenNodes: false });
    };
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(fit);
    });
    return () => cancelAnimationFrame(frame);
  }, [fitKey, fitView, nodesInitialized]);

  useEffect(() => {
    if (!nodesInitialized || !canvasRef.current) {
      return;
    }
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
      frame = requestAnimationFrame(() => {
        frame = null;
        void fitView({ padding: 0.18, duration: 0, includeHiddenNodes: false });
      });
    });
    observer.observe(canvasRef.current);
    return () => {
      observer.disconnect();
      if (frame !== null) {
        cancelAnimationFrame(frame);
      }
    };
  }, [canvasRef, fitView, nodesInitialized]);

  return null;
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
