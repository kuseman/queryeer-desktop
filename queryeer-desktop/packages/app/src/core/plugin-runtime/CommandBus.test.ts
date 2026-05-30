import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandBus } from "./CommandBus";

const originalWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    appShell: {
      evaluateExpressionSync: (params: { expression: string; context: Record<string, unknown> }) => {
        try {
          const keys = Object.keys(params.context);
          const values = keys.map((key) => params.context[key]);
          const runner = new Function(...keys, `return (${params.expression});`) as (...args: unknown[]) => unknown;
          return { ok: true as const, result: runner(...values) };
        } catch (error) {
          return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
        }
      }
    }
  };
});

afterEach(() => {
  (globalThis as { window?: unknown }).window = originalWindow;
});

describe("CommandBus", () => {
  it("blocks execution when enablement evaluates false", async () => {
    const handler = vi.fn();
    const bus = new CommandBus(() => ({ backendHealthy: false }));
    bus.register("queryengine.execute", handler, "backendHealthy");

    expect(bus.canExecute("queryengine.execute")).toBe(false);

    const result = await bus.execute("queryengine.execute");
    expect(result).toEqual({
      commandId: "queryengine.execute",
      executed: false,
      reason: "disabled-by-enablement"
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("executes command when enablement evaluates true", async () => {
    const handler = vi.fn();
    const bus = new CommandBus(() => ({ backendHealthy: true }));
    bus.register("queryengine.execute", handler, "backendHealthy");

    const result = await bus.execute("queryengine.execute");
    expect(result).toEqual({
      commandId: "queryengine.execute",
      executed: true
    });
    expect(handler).toHaveBeenCalledOnce();
  });
});
