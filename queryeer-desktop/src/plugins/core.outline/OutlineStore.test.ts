import { describe, it, expect, beforeEach } from "vitest";
import { OutlineStore, createOutlineStore } from "./OutlineStore";
import type { OutlineSymbol } from "../../contracts/extensions/OutlineExtension";

describe("OutlineStore", () => {
  let store: OutlineStore;

  const sampleSymbol: OutlineSymbol = {
    id: "json:foo:1",
    name: "foo",
    kind: "Key",
    range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 },
    selectionRange: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 }
  };

  beforeEach(() => {
    store = createOutlineStore();
  });

  it("returns initial state", () => {
    const state = store.getState();
    expect(state.symbols).toEqual([]);
    expect(state.selectedSymbolId).toBeNull();
    expect(state.expandedSymbolIds).toEqual(new Set());
    expect(state.hasOutlineCapability).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.showHelp).toBe(false);
  });

  it("sets symbols", () => {
    store.setSymbols([sampleSymbol]);
    expect(store.getState().symbols).toEqual([sampleSymbol]);
  });

  it("sets selected symbol id", () => {
    store.setSelectedSymbolId("json:foo:1");
    expect(store.getState().selectedSymbolId).toBe("json:foo:1");
  });

  it("toggles expanded symbol ids", () => {
    store.toggleExpanded("json:foo:1");
    expect(store.getState().expandedSymbolIds.has("json:foo:1")).toBe(true);

    store.toggleExpanded("json:foo:1");
    expect(store.getState().expandedSymbolIds.has("json:foo:1")).toBe(false);
  });

  it("sets has outline capability", () => {
    store.setHasOutlineCapability(true);
    expect(store.getState().hasOutlineCapability).toBe(true);
    store.setHasOutlineCapability(false);
    expect(store.getState().hasOutlineCapability).toBe(false);
  });

  it("sets error", () => {
    store.setError("Something went wrong");
    expect(store.getState().error).toBe("Something went wrong");
  });

  it("clears state but preserves outline capability", () => {
    store.setHasOutlineCapability(true);
    store.setSymbols([sampleSymbol]);
    store.setSelectedSymbolId("json:foo:1");
    store.toggleExpanded("json:foo:1");
    store.setError("error");

    store.clear();

    const state = store.getState();
    expect(state.symbols).toEqual([]);
    expect(state.selectedSymbolId).toBeNull();
    expect(state.expandedSymbolIds).toEqual(new Set());
    expect(state.hasOutlineCapability).toBe(true);
    expect(state.error).toBeNull();
  });

  it("clears state and resets outline capability when resetCapability is true", () => {
    store.setHasOutlineCapability(true);
    store.setSymbols([sampleSymbol]);
    store.setSelectedSymbolId("json:foo:1");

    store.clear(true);

    const state = store.getState();
    expect(state.symbols).toEqual([]);
    expect(state.selectedSymbolId).toBeNull();
    expect(state.hasOutlineCapability).toBe(false);
  });

  it("notifies subscribers on state change", () => {
    let callCount = 0;
    store.subscribe(() => {
      callCount++;
    });

    store.setSymbols([sampleSymbol]);
    expect(callCount).toBe(1);

    store.setSelectedSymbolId("json:foo:1");
    expect(callCount).toBe(2);
  });

  it("unsubscribe removes listener", () => {
    let callCount = 0;
    const unsub = store.subscribe(() => {
      callCount++;
    });

    store.setSymbols([sampleSymbol]);
    expect(callCount).toBe(1);

    unsub();
    store.setSelectedSymbolId("json:foo:1");
    expect(callCount).toBe(1);
  });

  it("toggles help dialog state", () => {
    expect(store.getState().showHelp).toBe(false);
    store.setShowHelp(true);
    expect(store.getState().showHelp).toBe(true);
    store.setShowHelp(false);
    expect(store.getState().showHelp).toBe(false);
  });

  it("clear preserves showHelp state", () => {
    store.setShowHelp(true);
    store.clear();
    expect(store.getState().showHelp).toBe(true);
  });
});