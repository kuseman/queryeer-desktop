import { beforeEach, describe, expect, it } from "vitest";
import { getQueryPlanInteractionStore } from "./interaction-store";

describe("query plan interaction store", () => {
  beforeEach(() => {
    getQueryPlanInteractionStore().clear();
  });

  it("tracks selection and highlights", () => {
    const store = getQueryPlanInteractionStore();

    store.select("g1", { type: "vertex", entityId: "node-1" });
    store.setHighlightedVertices("g1", ["node-1", "node-2"]);
    store.setHighlightedEdges("g1", ["edge-1"]);

    const state = store.get("g1");
    expect(state.selection).toEqual({ type: "vertex", entityId: "node-1" });
    expect(state.highlightedVertexIds).toEqual(["node-1", "node-2"]);
    expect(state.highlightedEdgeIds).toEqual(["edge-1"]);
  });

  it("merges highlights when replace is false", () => {
    const store = getQueryPlanInteractionStore();

    store.setHighlightedVertices("g1", ["node-1"]);
    store.setHighlightedVertices("g1", ["node-1", "node-2"], { replace: false });

    expect(store.get("g1").highlightedVertexIds).toEqual(["node-1", "node-2"]);
  });

  it("supports clear operations", () => {
    const store = getQueryPlanInteractionStore();

    store.select("g1", { type: "edge", entityId: "edge-1" });
    store.setHighlightedVertices("g1", ["node-1"]);
    store.clearHighlights("g1");
    store.clearSelection("g1");

    const state = store.get("g1");
    expect(state.selection).toBeNull();
    expect(state.highlightedVertexIds).toEqual([]);
    expect(state.highlightedEdgeIds).toEqual([]);
  });
});
