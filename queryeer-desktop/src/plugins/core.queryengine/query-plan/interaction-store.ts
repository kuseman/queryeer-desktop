import { useSyncExternalStore } from "react";
import type { GraphEntityType } from "../../../contracts/graph";

export type QueryPlanSelectionRef = {
  type: GraphEntityType;
  entityId: string;
};

export type QueryPlanInteractionState = {
  selection: QueryPlanSelectionRef | null;
  highlightedVertexIds: string[];
  highlightedEdgeIds: string[];
  updatedAtMs: number;
};

type HighlightOptions = {
  replace?: boolean;
};

const EMPTY_STATE: QueryPlanInteractionState = {
  selection: null,
  highlightedVertexIds: [],
  highlightedEdgeIds: [],
  updatedAtMs: 0
};

class QueryPlanInteractionStore {
  private readonly byGraphId = new Map<string, QueryPlanInteractionState>();
  private readonly listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  get(graphId: string): QueryPlanInteractionState {
    return this.byGraphId.get(graphId) ?? EMPTY_STATE;
  }

  select(graphId: string, selection: QueryPlanSelectionRef): void {
    this.update(graphId, (previous) => ({
      ...previous,
      selection
    }));
  }

  clearSelection(graphId: string): void {
    this.update(graphId, (previous) => ({
      ...previous,
      selection: null
    }));
  }

  setHighlightedVertices(graphId: string, vertexIds: string[], options: HighlightOptions = {}): void {
    this.update(graphId, (previous) => ({
      ...previous,
      highlightedVertexIds: options.replace === false
        ? uniqueIds([...previous.highlightedVertexIds, ...vertexIds])
        : uniqueIds(vertexIds)
    }));
  }

  setHighlightedEdges(graphId: string, edgeIds: string[], options: HighlightOptions = {}): void {
    this.update(graphId, (previous) => ({
      ...previous,
      highlightedEdgeIds: options.replace === false
        ? uniqueIds([...previous.highlightedEdgeIds, ...edgeIds])
        : uniqueIds(edgeIds)
    }));
  }

  clearHighlights(graphId: string): void {
    this.update(graphId, (previous) => ({
      ...previous,
      highlightedVertexIds: [],
      highlightedEdgeIds: []
    }));
  }

  clearGraph(graphId: string): void {
    if (this.byGraphId.delete(graphId)) {
      this.emit();
    }
  }

  clear(): void {
    if (this.byGraphId.size === 0) {
      return;
    }
    this.byGraphId.clear();
    this.emit();
  }

  private update(graphId: string, mutator: (previous: QueryPlanInteractionState) => QueryPlanInteractionState): void {
    const previous = this.byGraphId.get(graphId) ?? EMPTY_STATE;
    const next = mutator(previous);
    if (isSameState(previous, next)) {
      return;
    }
    this.byGraphId.set(graphId, {
      ...next,
      updatedAtMs: Date.now()
    });
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

const interactionStore = new QueryPlanInteractionStore();

export function getQueryPlanInteractionStore(): QueryPlanInteractionStore {
  return interactionStore;
}

export function useQueryPlanInteractionState(graphId: string): QueryPlanInteractionState {
  const store = getQueryPlanInteractionStore();
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(graphId),
    () => store.get(graphId)
  );
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function isSameState(left: QueryPlanInteractionState, right: QueryPlanInteractionState): boolean {
  return sameSelection(left.selection, right.selection)
    && sameIds(left.highlightedVertexIds, right.highlightedVertexIds)
    && sameIds(left.highlightedEdgeIds, right.highlightedEdgeIds);
}

function sameSelection(left: QueryPlanSelectionRef | null, right: QueryPlanSelectionRef | null): boolean {
  return left?.type === right?.type && left?.entityId === right?.entityId;
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}
