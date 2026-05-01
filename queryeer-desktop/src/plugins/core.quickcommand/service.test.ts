import { beforeEach, describe, expect, it, vi } from "vitest";
import { QuickCommandService } from "./service";
import type { QuickCommandContext, QuickCommandItem, QuickCommandProvider } from "../../contracts/extensions/QuickCommandExtension";

beforeEach(() => {
  localStorage.clear();
});

function makeCtx(overrides: Partial<QuickCommandContext> = {}): QuickCommandContext {
  return { activeFile: undefined, openFiles: [], ...overrides };
}

function makeItem(id: string, title: string): QuickCommandItem {
  return { id, title, action: vi.fn() };
}

function makeProvider(overrides: Partial<QuickCommandProvider> = {}): QuickCommandProvider {
  return {
    label: "Test",
    getItems: () => [],
    ...overrides
  };
}

describe("QuickCommandService.open / close", () => {
  it("starts closed", () => {
    const svc = new QuickCommandService([]);
    expect(svc.getState().open).toBe(false);
  });

  it("opens with the given prefill query", () => {
    const svc = new QuickCommandService([]);
    svc.open(">");
    expect(svc.getState()).toEqual({ open: true, query: ">" });
  });

  it("closes and resets query", () => {
    const svc = new QuickCommandService([]);
    svc.open("abc");
    svc.close();
    expect(svc.getState()).toEqual({ open: false, query: "" });
  });

  it("notifies subscribers on state changes", () => {
    const svc = new QuickCommandService([]);
    const listener = vi.fn();
    svc.subscribe(listener);
    svc.open("x");
    expect(listener).toHaveBeenCalledWith({ open: true, query: "x" });
    svc.close();
    expect(listener).toHaveBeenCalledWith({ open: false, query: "" });
  });

  it("unsubscribe stops future notifications", () => {
    const svc = new QuickCommandService([]);
    const listener = vi.fn();
    const unsub = svc.subscribe(listener);
    unsub();
    svc.open();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("QuickCommandService.resolveItems — prefix routing", () => {
  it("returns items from all providers when no prefix match", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({ label: "A", getItems: () => [makeItem("a1", "Alpha")] }),
      makeProvider({ label: "B", prefix: ">", getItems: () => [makeItem("b1", "Beta")] })
    ];
    const svc = new QuickCommandService(providers);
    const items = await svc.resolveItems("alpha", makeCtx());
    const ids = items.map((i) => i.id);
    expect(ids).toContain("a1");
    // 'b1' doesn't match query 'alpha' via fuzzy, so it's excluded — that's fine
  });

  it("returns only the matching provider's items when query starts with prefix", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({ label: "A", getItems: () => [makeItem("a1", "Alpha")] }),
      makeProvider({ label: "B", prefix: ">", getItems: () => [makeItem("b1", "Beta"), makeItem("b2", "Bravo")] })
    ];
    const svc = new QuickCommandService(providers);
    const items = await svc.resolveItems("> ", makeCtx());
    const ids = items.map((i) => i.id);
    expect(ids).toContain("b1");
    expect(ids).toContain("b2");
    expect(ids).not.toContain("a1");
  });

  it("excludes items that don't fuzzy-match the query", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({
        label: "X",
        getItems: () => [makeItem("x1", "Format Document"), makeItem("x2", "Toggle Word Wrap")]
      })
    ];
    const svc = new QuickCommandService(providers);
    const items = await svc.resolveItems("fmt", makeCtx());
    const ids = items.map((i) => i.id);
    expect(ids).toContain("x1");      // "fmt" matches "Format"
    expect(ids).not.toContain("x2"); // "fmt" doesn't match "Toggle Word Wrap"
  });
});

describe("QuickCommandService.resolveItems — ranking", () => {
  it("sorts recently-used items to the top when query is empty", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({
        label: "X",
        getItems: () => [makeItem("x1", "Alpha"), makeItem("x2", "Beta"), makeItem("x3", "Gamma")]
      })
    ];
    const svc = new QuickCommandService(providers);

    // Record x3 as most recent, x1 second-most
    await svc.execute(makeItem("x1", "Alpha"));
    await svc.execute(makeItem("x3", "Gamma"));

    // Re-create service with same localStorage to simulate reload
    const svc2 = new QuickCommandService(providers);
    const items = await svc2.resolveItems("", makeCtx());
    const ids = items.map((i) => i.id);

    expect(ids.indexOf("x3")).toBeLessThan(ids.indexOf("x1"));
    expect(ids.indexOf("x1")).toBeLessThan(ids.indexOf("x2"));
  });

  it("uses fuzzy score as primary rank when query is non-empty", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({
        label: "X",
        getItems: () => [makeItem("x1", "format"), makeItem("x2", "find on replace terms")]
      })
    ];
    const svc = new QuickCommandService(providers);
    // Record x2 as more recently used
    await svc.execute(makeItem("x2", "find on replace terms"));

    const items = await svc.resolveItems("for", makeCtx());
    const ids = items.map((i) => i.id);
    // "for" is a contiguous prefix of "format" — should score higher than scattered in x2
    expect(ids.indexOf("x1")).toBeLessThan(ids.indexOf("x2"));
  });
});

describe("QuickCommandService.resolveItems — when filtering", () => {
  it("includes provider when when-expression is true", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({ label: "A", when: "hasActiveTextEditor", getItems: () => [makeItem("a1", "Alpha")] })
    ];
    const svc = new QuickCommandService(providers, () => ({ hasActiveTextEditor: true }));
    const items = await svc.resolveItems("", makeCtx());
    expect(items.map((i) => i.id)).toContain("a1");
  });

  it("excludes provider when when-expression is false", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({ label: "A", when: "hasActiveTextEditor", getItems: () => [makeItem("a1", "Alpha")] })
    ];
    const svc = new QuickCommandService(providers, () => ({ hasActiveTextEditor: false }));
    const items = await svc.resolveItems("", makeCtx());
    expect(items.map((i) => i.id)).not.toContain("a1");
  });

  it("includes all providers when no getContextValues supplied", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({ label: "A", when: "hasActiveTextEditor", getItems: () => [makeItem("a1", "Alpha")] })
    ];
    const svc = new QuickCommandService(providers);
    const items = await svc.resolveItems("", makeCtx());
    expect(items.map((i) => i.id)).toContain("a1");
  });

  it("when filtering respects prefix routing", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({ label: "A", prefix: ">", when: "hasActiveTextEditor", getItems: () => [makeItem("a1", "Alpha")] }),
      makeProvider({ label: "B", prefix: ">", getItems: () => [makeItem("b1", "Beta")] })
    ];
    const svc = new QuickCommandService(providers, () => ({ hasActiveTextEditor: false }));
    const items = await svc.resolveItems("> ", makeCtx());
    const ids = items.map((i) => i.id);
    expect(ids).not.toContain("a1");
    expect(ids).toContain("b1");
  });
});

describe("QuickCommandService.execute", () => {
  it("calls item.action", async () => {
    const svc = new QuickCommandService([]);
    const action = vi.fn();
    const item = makeItem("cmd1", "Test");
    item.action = action;
    await svc.execute(item);
    expect(action).toHaveBeenCalledOnce();
  });

  it("records the item id in the recently-used store", async () => {
    const providers: QuickCommandProvider[] = [
      makeProvider({ label: "X", getItems: () => [makeItem("recorded", "Recorded")] })
    ];
    const svc = new QuickCommandService(providers);
    await svc.execute(makeItem("recorded", "Recorded"));

    const items = await svc.resolveItems("", makeCtx());
    expect(items[0]?.id).toBe("recorded");
  });

  it("closes the panel after execution", async () => {
    const svc = new QuickCommandService([]);
    svc.open();
    await svc.execute(makeItem("x", "X"));
    expect(svc.getState().open).toBe(false);
  });
});
