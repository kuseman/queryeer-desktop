import { describe, expect, it, vi } from "vitest";
import { CommandBus } from "./CommandBus";

describe("CommandBus", () => {
  it("blocks execution when enablement evaluates false", async () => {
    const handler = vi.fn();
    const bus = new CommandBus(() => ({ backendHealthy: false }));
    bus.register("query.execute", handler, "backendHealthy");

    expect(bus.canExecute("query.execute")).toBe(false);

    const result = await bus.execute("query.execute");
    expect(result).toEqual({
      commandId: "query.execute",
      executed: false,
      reason: "disabled-by-enablement"
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("executes command when enablement evaluates true", async () => {
    const handler = vi.fn();
    const bus = new CommandBus(() => ({ backendHealthy: true }));
    bus.register("query.execute", handler, "backendHealthy");

    const result = await bus.execute("query.execute");
    expect(result).toEqual({
      commandId: "query.execute",
      executed: true
    });
    expect(handler).toHaveBeenCalledOnce();
  });
});
