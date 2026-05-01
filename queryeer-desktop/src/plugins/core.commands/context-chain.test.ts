import { describe, it, expect, vi, beforeEach } from "vitest";
import { createContextChain } from "./context-chain";
import { ContextPriority } from "./context-priority";

describe("createContextChain", () => {
  let chain: ReturnType<typeof createContextChain>;

  beforeEach(() => {
    chain = createContextChain();
  });

  describe("register", () => {
    it("adds scope and notifies listeners", () => {
      const listener = vi.fn();
      chain.onDidChange(listener);
      chain.register({ id: "a", priority: ContextPriority.ZONE, context: { x: true } });
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("returned unregister removes scope and notifies", () => {
      const listener = vi.fn();
      const unregister = chain.register({ id: "a", priority: ContextPriority.ZONE, context: {} });
      chain.onDidChange(listener);
      unregister();
      expect(listener).toHaveBeenCalledTimes(1);
      expect(chain.getActiveChain()).toHaveLength(0);
    });

    it("unregister clears lastActive for that priority when it was the active scope", () => {
      const unregister = chain.register({
        id: "editor",
        priority: ContextPriority.EDITOR_INSTANCE,
        context: {}
      });
      chain.activate("editor");
      expect(chain.getLastFocusedScopeId(ContextPriority.EDITOR_INSTANCE)).toBe("editor");
      unregister();
      expect(chain.getLastFocusedScopeId(ContextPriority.EDITOR_INSTANCE)).toBeNull();
    });

    it("unregister does not clear lastActive when another scope was activated last", () => {
      chain.register({ id: "a", priority: ContextPriority.EDITOR_INSTANCE, context: {} });
      const unregisterB = chain.register({
        id: "b",
        priority: ContextPriority.EDITOR_INSTANCE,
        context: {}
      });
      chain.activate("a");
      unregisterB();
      expect(chain.getLastFocusedScopeId(ContextPriority.EDITOR_INSTANCE)).toBe("a");
    });
  });

  describe("update", () => {
    it("replaces scope context and notifies listeners", () => {
      const listener = vi.fn();
      chain.register({ id: "a", priority: ContextPriority.ZONE, context: { x: false } });
      chain.onDidChange(listener);
      chain.update("a", { x: true });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(chain.getEffectiveContext().x).toBe(true);
    });

    it("is a no-op for unregistered id", () => {
      const listener = vi.fn();
      chain.onDidChange(listener);
      chain.update("missing", { x: true });
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("activate", () => {
    it("records last active scope per priority", () => {
      chain.register({ id: "a", priority: ContextPriority.EDITOR_INSTANCE, context: {} });
      chain.register({ id: "b", priority: ContextPriority.EDITOR_INSTANCE, context: {} });
      chain.activate("a");
      expect(chain.getLastFocusedScopeId(ContextPriority.EDITOR_INSTANCE)).toBe("a");
      chain.activate("b");
      expect(chain.getLastFocusedScopeId(ContextPriority.EDITOR_INSTANCE)).toBe("b");
    });

    it("is a no-op for unregistered id", () => {
      chain.activate("missing");
      expect(chain.getLastFocusedScopeId(ContextPriority.EDITOR_INSTANCE)).toBeNull();
    });

    it("tracks independently per priority level", () => {
      chain.register({ id: "zone", priority: ContextPriority.ZONE, context: {} });
      chain.register({ id: "editor", priority: ContextPriority.EDITOR_INSTANCE, context: {} });
      chain.activate("zone");
      chain.activate("editor");
      expect(chain.getLastFocusedScopeId(ContextPriority.ZONE)).toBe("zone");
      expect(chain.getLastFocusedScopeId(ContextPriority.EDITOR_INSTANCE)).toBe("editor");
    });
  });

  describe("getEffectiveContext", () => {
    it("merges all scopes, higher priority wins on conflict", () => {
      chain.register({
        id: "low",
        priority: ContextPriority.WORKBENCH,
        context: { shared: "low", onlyLow: true }
      });
      chain.register({
        id: "high",
        priority: ContextPriority.EDITOR_INSTANCE,
        context: { shared: "high", onlyHigh: true }
      });
      const ctx = chain.getEffectiveContext();
      expect(ctx.shared).toBe("high");
      expect(ctx.onlyLow).toBe(true);
      expect(ctx.onlyHigh).toBe(true);
    });

    it("returns empty object when no scopes registered", () => {
      expect(chain.getEffectiveContext()).toEqual({});
    });

    it("returns single scope context directly", () => {
      chain.register({
        id: "a",
        priority: ContextPriority.ZONE,
        context: { editorFocus: true }
      });
      expect(chain.getEffectiveContext()).toEqual({ editorFocus: true });
    });
  });

  describe("getActiveChain", () => {
    it("returns scopes sorted ascending by priority", () => {
      chain.register({ id: "b", priority: ContextPriority.EDITOR_INSTANCE, context: {} });
      chain.register({ id: "a", priority: ContextPriority.WORKBENCH, context: {} });
      chain.register({ id: "c", priority: ContextPriority.ZONE, context: {} });
      const ids = chain.getActiveChain().map((s) => s.id);
      expect(ids).toEqual(["a", "c", "b"]);
    });
  });

  describe("onDidChange", () => {
    it("returns unsubscribe function", () => {
      const listener = vi.fn();
      const off = chain.onDidChange(listener);
      chain.register({ id: "a", priority: ContextPriority.ZONE, context: {} });
      expect(listener).toHaveBeenCalledTimes(1);
      off();
      chain.register({ id: "b", priority: ContextPriority.ZONE, context: {} });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
