import { describe, expect, it, vi } from "vitest";
import { QueryOutputFormatRegistry } from "./QueryOutputFormatRegistry";
import type { QueryResultFormatter } from "./QueryOutputFormatRegistry";

function makeFormatter(id: string): QueryResultFormatter {
  return {
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    format: () => [],
    formatFile: () => ""
  };
}

describe("QueryOutputFormatRegistry", () => {
  it("registers and retrieves formatters", () => {
    const registry = new QueryOutputFormatRegistry();
    registry.register(makeFormatter("csv"));
    registry.register(makeFormatter("json"));

    const all = registry.getFormatters();
    expect(all).toHaveLength(2);
    expect(all.map((f) => f.id)).toEqual(["csv", "json"]);
  });

  it("getFormatter returns undefined for unknown id", () => {
    const registry = new QueryOutputFormatRegistry();
    expect(registry.getFormatter("unknown")).toBeUndefined();
  });

  it("getFormatter returns matching formatter", () => {
    const registry = new QueryOutputFormatRegistry();
    registry.register(makeFormatter("csv"));
    expect(registry.getFormatter("csv")?.id).toBe("csv");
  });

  it("notifies subscribers on register", () => {
    const registry = new QueryOutputFormatRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    registry.register(makeFormatter("csv"));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe removes listener", () => {
    const registry = new QueryOutputFormatRegistry();
    const listener = vi.fn();
    const unsub = registry.subscribe(listener);
    unsub();
    registry.register(makeFormatter("csv"));
    expect(listener).not.toHaveBeenCalled();
  });
});
