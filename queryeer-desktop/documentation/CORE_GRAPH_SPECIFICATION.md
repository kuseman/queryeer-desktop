# Core Graph Specification

Status: implementation baseline for `core.graph`.

## Goals

- Provide a renderer-agnostic graph contract for query plans, schema visualization, procedure call trees, and similar features.
- Support vertices, edges, automatic layout, pan/zoom, styling, entity actions, tooltips, and a properties panel.
- Keep backend-produced graph payloads independent from frontend rendering libraries.
- Allow the frontend renderer to start with React Flow and Dagre while preserving a feasible migration path to Cytoscape or another renderer.

## Non-goals for the first implementation

- SQL Server ShowPlan XML conversion is not implemented in this session. SQL Server dialect code will later convert ShowPlan XML into this contract.
- Opening graph documents in standalone editor tabs is deferred. The first integration is query output artifacts.
- Large graph optimization for thousands of entities is deferred. The initial target is tens to low hundreds of vertices.
- ELK layout integration is deferred. Dagre is the initial MIT-licensed layout provider.

## Library choices

- Renderer: `@xyflow/react` (React Flow), hidden behind `core.graph` UI components and adapters.
- Layout: `@dagrejs/dagre`, hidden behind a `GraphLayoutProvider` abstraction.
- Future layout option: `elkjs`, only if its EPL-2.0 obligations are accepted and Dagre quality is insufficient.
- Future renderer option: Cytoscape, primarily if graph sizes or graph-analysis needs exceed React Flow's strengths.

## Renderer boundary

Public graph contracts MUST NOT expose React Flow concepts such as `Node`, `Edge`, handles, positions, or viewport types.

Renderer-specific concepts live inside adapter files under `core.graph`. Consumers provide plain `GraphDocument` data and callback-based actions.

## Graph contract

`GraphDocument` is the backend/frontend shared contract.

```ts
type GraphDocument = {
  id: string;
  title?: string;
  description?: string;
  layout?: GraphLayoutOptions;
  vertices: GraphVertex[];
  edges: GraphEdge[];
};

type GraphVertex = {
  id: string;
  label: string;
  kind?: string;
  description?: string;
  style?: GraphVertexStyle;
  properties?: GraphPropertyGroup[];
  actions?: GraphAction[];
};

type GraphEdge = {
  id: string;
  sourceVertexId: string;
  targetVertexId: string;
  label?: string;
  kind?: string;
  style?: GraphEdgeStyle;
  properties?: GraphPropertyGroup[];
  actions?: GraphAction[];
};

type GraphPropertyGroup = {
  id: string;
  label: string;
  properties: GraphProperty[];
};

type GraphProperty = {
  id: string;
  label: string;
  value: string | number | boolean | null;
  unit?: string;
  important?: boolean;
};

type GraphAction = {
  id: string;
  label: string;
  disabled?: boolean;
};
```

Property values are scalar in v1. Backends should stringify native structured values before sending them. A later contract can add explicit JSON-valued properties if needed.

## Styling

Vertex style supports:

- `shape`: `rectangle`, `rounded`, `ellipse`, `diamond`
- `color`, `backgroundColor`, `borderColor`
- `iconUrl` or `imageUrl`
- `width`, `height`

Edge style supports:

- `shape`: `straight`, `step`, `smoothstep`, `bezier`
- `color`
- `width`
- `dash`
- `markerEnd`: `arrow`, `none`

## Layout

```ts
type GraphLayoutOptions = {
  direction?: "top-bottom" | "bottom-top" | "left-right" | "right-left";
  rankSpacing?: number;
  nodeSpacing?: number;
};
```

The first provider maps this to Dagre `rankdir`, `ranksep`, and `nodesep`.

## Interaction

`GraphViewer` exposes callback-based events:

- `onSelectionChanged(entity | null)`
- `onEntityAction({ graphId, entityType, entityId, actionId })`

Clicking vertices or edges updates selection and the properties panel. Right-clicking vertices or edges opens a context menu for the entity's `actions`.

## Tooltips and properties panel

Vertices and edges share the same property model.

- Tooltip shows only properties where `important === true`.
- Properties panel shows all groups and properties for the selected entity.
- Properties panel is collapsible and horizontally resizable so graph focus can be restored quickly.

## Query output integration

Query execution completion may include output artifacts:

```ts
type QueryOutputArtifact = {
  id: string;
  capability: string;
  kind: "graph";
  title?: string;
  graph: GraphDocument;
};
```

For query plans:

- `queryengine.completed.features` includes `"plan"`.
- `queryengine.completed.artifacts` includes a graph artifact with `capability: "plan"`.
- The graph output contributor registers as an adhoc output contributor for `capability: "plan"`.
- The frontend renders the first matching graph artifact.

## Backend responsibility

Backends and dialects MUST convert native plan/schema/call-tree data into `GraphDocument` before sending it to the frontend.

Examples:

- SQL Server dialect converts ShowPlan XML into `GraphDocument`.
- Schema visualization code converts catalog metadata into `GraphDocument`.
- Procedure tooling converts call graphs into `GraphDocument`.

The frontend graph renderer does not parse engine-native formats.
