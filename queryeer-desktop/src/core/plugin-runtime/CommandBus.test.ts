import { describe, expect, it, vi } from "vitest";
import { CommandBus } from "./CommandBus";

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
