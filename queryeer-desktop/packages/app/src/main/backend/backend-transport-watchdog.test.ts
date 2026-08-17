import { describe, expect, it, vi } from "vitest";
import type { BackendEnvelope } from "@queryeer/api/backend/index.js";
import { WatchdogBackendTransport } from "./backend-transport-watchdog.js";
import type { BackendTransport, BackendTransportCallbacks } from "./backend-transport.js";

describe("WatchdogBackendTransport", () => {
  it("restarts intentionally without watchdog delay and runs beforeStart while stopped", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const diagnostics: string[] = [];
    const diedHook = vi.fn();
    const restartReady = vi.fn(async () => {
      events.push("restart-ready");
    });
    let instance = 0;

    const transport = new WatchdogBackendTransport(
      {
        mode: "mock-stdio",
        create: (callbacks) => {
          instance += 1;
          return createTransport(instance, callbacks, events);
        }
      },
      {
        onEnvelope: () => {},
        onDiagnostic: (event) => diagnostics.push(event.message)
      },
      restartReady,
      diedHook
    );

    await transport.start();
    await transport.restart(async () => {
      events.push("before-start");
    });

    expect(events).toEqual([
      "start-1",
      "stop-1",
      "before-start",
      "start-2",
      "restart-ready"
    ]);
    expect(diedHook).not.toHaveBeenCalled();
    expect(diagnostics.some((message) => message.includes("restarting in"))).toBe(false);
    expect(vi.getTimerCount()).toBe(0);

    await transport.stop();
    vi.useRealTimers();
  });

  it("falls back to watchdog recovery when the stopped-phase hook fails", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let instance = 0;
    const transport = new WatchdogBackendTransport(
      {
        mode: "mock-stdio",
        create: (callbacks) => createTransport(++instance, callbacks, events)
      },
      { onEnvelope: () => {}, onDiagnostic: () => {} },
      async () => { events.push("restart-ready"); }
    );
    await transport.start();

    await expect(transport.restart(async () => { throw new Error("staging failed"); }))
      .rejects.toThrow("staging failed");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).toEqual(["start-1", "stop-1", "start-2", "restart-ready"]);
    await transport.stop();
    vi.useRealTimers();
  });
});

function createTransport(
  instance: number,
  callbacks: BackendTransportCallbacks,
  events: string[]
): BackendTransport {
  return {
    mode: "mock-stdio",
    start: async () => {
      events.push(`start-${instance}`);
    },
    stop: async () => {
      events.push(`stop-${instance}`);
      callbacks.onDied();
    },
    sendEnvelope: (_envelope: BackendEnvelope) => {}
  };
}
