import { afterEach, describe, expect, it, vi } from "vitest";
import { RecurringExecutionController } from "./RecurringExecutionController";

describe("RecurringExecutionController", () => {
  afterEach(() => vi.useRealTimers());

  it("runs immediately and then at the configured interval", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const controller = new RecurringExecutionController(5, onTick);

    controller.start();
    expect(onTick).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(15_000);
    expect(onTick).toHaveBeenCalledTimes(4);
  });

  it("stops future ticks and is safe to stop repeatedly", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const controller = new RecurringExecutionController(1, onTick);

    controller.start();
    controller.stop();
    controller.stop();
    vi.advanceTimersByTime(5_000);

    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("does not install multiple timers when started repeatedly", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const controller = new RecurringExecutionController(1, onTick);

    controller.start();
    controller.start();
    vi.advanceTimersByTime(1_000);

    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid intervals", () => {
    expect(() => new RecurringExecutionController(0, vi.fn())).toThrow("positive whole number");
    expect(() => new RecurringExecutionController(1.5, vi.fn())).toThrow("positive whole number");
  });

  it("pauses after repeated infrastructure failures and can reset after success", () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const onStatusChanged = vi.fn();
    const controller = new RecurringExecutionController(5, onTick, onStatusChanged);
    controller.start();

    expect(controller.recordInfrastructureFailure("Backend unavailable")).toBe(false);
    expect(controller.recordInfrastructureFailure("Backend unavailable")).toBe(false);
    expect(controller.recordInfrastructureFailure("Backend unavailable")).toBe(true);
    expect(controller.getStatus()).toEqual(expect.objectContaining({
      paused: true,
      pauseReason: "Backend unavailable",
      consecutiveInfrastructureFailures: 3
    }));

    vi.advanceTimersByTime(20_000);
    expect(onTick).toHaveBeenCalledTimes(1);
    controller.recordSuccess();
    expect(controller.getStatus().consecutiveInfrastructureFailures).toBe(0);
  });

  it("pauses immediately with a user-facing reason", () => {
    vi.useFakeTimers();
    const controller = new RecurringExecutionController(1, vi.fn());
    controller.start();
    controller.pause("Security vault is locked");

    expect(controller.getStatus()).toEqual(expect.objectContaining({
      paused: true,
      pauseReason: "Security vault is locked"
    }));
    expect(controller.getStatus().nextRunAtMs).toBeUndefined();
  });
});
