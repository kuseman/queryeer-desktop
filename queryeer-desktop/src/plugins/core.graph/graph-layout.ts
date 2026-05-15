import dagre from "@dagrejs/dagre";
import type { GraphDocument, GraphLayoutDirection } from "../../contracts/graph";

export type PositionedGraphVertex = GraphDocument["vertices"][number] & {
  position: { x: number; y: number };
};

export type PositionedGraphDocument = Omit<GraphDocument, "vertices"> & {
  vertices: PositionedGraphVertex[];
};

export type GraphLayoutProvider = {
  layout(graph: GraphDocument): PositionedGraphDocument;
};

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_HEIGHT = 72;

const DIRECTION_TO_DAGRE: Record<GraphLayoutDirection, string> = {
  "top-bottom": "TB",
  "bottom-top": "BT",
  "left-right": "LR",
  "right-left": "RL"
};

export const dagreGraphLayoutProvider: GraphLayoutProvider = {
  layout(graph) {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({
      rankdir: DIRECTION_TO_DAGRE[graph.layout?.direction ?? "top-bottom"],
      ranksep: graph.layout?.rankSpacing ?? 90,
      nodesep: graph.layout?.nodeSpacing ?? 70
    });

    for (const vertex of graph.vertices) {
      dagreGraph.setNode(vertex.id, {
        width: vertex.style?.width ?? DEFAULT_NODE_WIDTH,
        height: vertex.style?.height ?? DEFAULT_NODE_HEIGHT
      });
    }

    for (const edge of graph.edges) {
      dagreGraph.setEdge(edge.sourceVertexId, edge.targetVertexId, { id: edge.id });
    }

    dagre.layout(dagreGraph);

    return {
      ...graph,
      vertices: graph.vertices.map((vertex) => {
        const node = dagreGraph.node(vertex.id) as { x?: number; y?: number; width?: number; height?: number } | undefined;
        const width = vertex.style?.width ?? DEFAULT_NODE_WIDTH;
        const height = vertex.style?.height ?? DEFAULT_NODE_HEIGHT;
        return {
          ...vertex,
          position: {
            x: (node?.x ?? 0) - width / 2,
            y: (node?.y ?? 0) - height / 2
          }
        };
      })
    };
  }
};
