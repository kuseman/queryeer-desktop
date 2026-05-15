import { describe, expect, it, vi } from "vitest";
import { BackendStatusStore } from "./backend-status-store.js";

describe("BackendStatusStore", () => {
  it("initializes with defaults and mode can be updated", () => {
    const store = new BackendStatusStore();
    expect(store.get().mode).toBe("mock-stdio");
    expect(store.get().state).toBe("starting");

    store.initializeMode("dev-maven");
    expect(store.get().mode).toBe("dev-maven");
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

  it("stores jvm memory from ping details", () => {
    const store = new BackendStatusStore();
    store.setPingDetails({
      timestamp: "2026-01-01T00:00:01.000Z",
      rttMs: 5,
      jvmHeapUsedBytes: 536870912,
      jvmHeapMaxBytes: 2147483648
    });

    const status = store.get();
    expect(status.jvmMemory).toBeDefined();
    expect(status.jvmMemory!.heapUsedBytes).toBe(536870912);
    expect(status.jvmMemory!.heapMaxBytes).toBe(2147483648);
  });

  it("retains previous jvm memory when new ping has none", () => {
    const store = new BackendStatusStore();
    store.setPingDetails({
      timestamp: "2026-01-01T00:00:01.000Z",
      rttMs: 5,
      jvmHeapUsedBytes: 536870912,
      jvmHeapMaxBytes: 2147483648
    });

    store.setPingDetails({
      timestamp: "2026-01-01T00:00:02.000Z",
      rttMs: 6
    });

    const status = store.get();
    expect(status.jvmMemory).toBeDefined();
    expect(status.jvmMemory!.heapUsedBytes).toBe(536870912);
  });
});
