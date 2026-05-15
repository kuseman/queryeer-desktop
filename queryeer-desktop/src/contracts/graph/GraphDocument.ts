export type GraphLayoutDirection = "top-bottom" | "bottom-top" | "left-right" | "right-left";

export type GraphLayoutOptions = {
  direction?: GraphLayoutDirection;
  rankSpacing?: number;
  nodeSpacing?: number;
};

export type GraphVertexShape = "rectangle" | "rounded" | "ellipse" | "diamond";

export type GraphVertexStyle = {
  shape?: GraphVertexShape;
  color?: string;
  backgroundColor?: string;
  borderColor?: string;
  iconUrl?: string;
  imageUrl?: string;
  width?: number;
  height?: number;
};

export type GraphEdgeShape = "straight" | "step" | "smoothstep" | "bezier";

export type GraphEdgeStyle = {
  shape?: GraphEdgeShape;
  color?: string;
  width?: number;
  dash?: boolean;
  markerEnd?: "arrow" | "none";
};

export type GraphPropertyValue = string | number | boolean | null;

export type GraphProperty = {
  id: string;
  label: string;
  value: GraphPropertyValue;
  unit?: string;
  important?: boolean;
};

export type GraphPropertyGroup = {
  id: string;
  label: string;
  properties: GraphProperty[];
};

export type GraphAction = {
  id: string;
  label: string;
  disabled?: boolean;
};

export type GraphVertexOverlayKind = "parallel" | "warning" | "info" | "custom";

export type GraphVertexOverlay = {
  id: string;
  kind: GraphVertexOverlayKind;
  label: string;
  title?: string;
  iconUrl?: string;
};

export type GraphVertex = {
  id: string;
  label: string;
  kind?: string;
  description?: string;
  style?: GraphVertexStyle;
  properties?: GraphPropertyGroup[];
  overlays?: GraphVertexOverlay[];
  actions?: GraphAction[];
};

export type GraphEdge = {
  id: string;
  sourceVertexId: string;
  targetVertexId: string;
  label?: string;
  kind?: string;
  style?: GraphEdgeStyle;
  properties?: GraphPropertyGroup[];
  actions?: GraphAction[];
};

export type GraphDocument = {
  id: string;
  title?: string;
  description?: string;
  layout?: GraphLayoutOptions;
  vertices: GraphVertex[];
  edges: GraphEdge[];
};

export type GraphEntityType = "vertex" | "edge";

export type GraphEntity =
  | { type: "vertex"; entity: GraphVertex }
  | { type: "edge"; entity: GraphEdge };

export type GraphActionInvocation = {
  graphId: string;
  entityType: GraphEntityType;
  entityId: string;
  actionId: string;
};
