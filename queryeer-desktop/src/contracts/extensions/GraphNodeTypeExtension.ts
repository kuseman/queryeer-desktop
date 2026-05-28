import type { ComponentType } from "react";
import type { GraphLayoutDirection, GraphVertex } from "../graph/GraphDocument.js";

export type GraphVertexNodeData = {
  vertex: GraphVertex;
  direction?: GraphLayoutDirection;
  iconResolver?: (label?: string, kind?: string) => string | undefined;
};

export type GraphNodeTypeProps = {
  data: GraphVertexNodeData;
  selected: boolean;
};

export type GraphNodeTypeComponent = ComponentType<GraphNodeTypeProps>;

export type GraphNodeTypeContribution = {
  kind: string | string[];
  component: GraphNodeTypeComponent;
};

export type GraphNodeTypeRegistry = {
  registerNodeType(contribution: GraphNodeTypeContribution): void;
  unregisterNodeType(kind: string): void;
  getComponent(kind: string): GraphNodeTypeComponent | undefined;
  getAll(): ReadonlyMap<string, GraphNodeTypeComponent>;
};
