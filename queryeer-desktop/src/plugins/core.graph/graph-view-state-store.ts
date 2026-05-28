import type { GraphLayoutDirection } from "../../contracts/graph/GraphDocument";

export type GraphViewState = {
  viewport: { x: number; y: number; zoom: number };
  layoutDirection: GraphLayoutDirection | "auto";
};

const store = new Map<string, GraphViewState>();

export function getGraphViewState(graphId: string): GraphViewState | undefined {
  return store.get(graphId);
}

export function setGraphViewState(graphId: string, state: GraphViewState): void {
  store.set(graphId, state);
}

export function clearGraphViewState(graphId: string): void {
  store.delete(graphId);
}
