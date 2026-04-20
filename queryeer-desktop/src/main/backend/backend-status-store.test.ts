import { describe, expect, it, vi } from "vitest";
import { BackendStatusStore } from "./backend-status-store";

describe("BackendStatusStore", () => {
  it("initializes with defaults and mode can be updated", () => {
    const store = new BackendStatusStore();
    expect(store.get().mode).toBe("mock-stdio");
    expect(store.get().state).toBe("starting");

    store.initializeMode("stdio-process");
    expect(store.get().mode).toBe("stdio-process");
  });

  it("updates handshake and ping details", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const store = new BackendStatusStore();
    store.setHandshakeDetails({
      protocolVersion: "1.0.0",
      serverName: "queryeer-java-backend",
      serverVersion: "0.1.0",
      supportedCapabilities: ["health.ping"]
    });

    let status = store.get();
    expect(status.protocolVersion).toBe("1.0.0");
    expect(status.serverName).toBe("queryeer-java-backend");
    expect(status.handshakeAt).toBe("2026-01-01T00:00:00.000Z");

    store.setPingDetails({
      timestamp: "2026-01-01T00:00:01.000Z",
      rttMs: 12
    });

    status = store.get();
    expect(status.state).toBe("healthy");
    expect(status.lastPingAt).toBe("2026-01-01T00:00:01.000Z");
    expect(status.lastPingRttMs).toBe(12);

    vi.useRealTimers();
  });
});
