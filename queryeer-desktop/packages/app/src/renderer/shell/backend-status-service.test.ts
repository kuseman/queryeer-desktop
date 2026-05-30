import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  getBackendStatusService,
  resetBackendStatusServiceForTests
} from "./backend-status-service";
import type { BackendGatewayStatus } from "@queryeer/api/backend/index.js";

describe("BackendStatusService", () => {
  let listeners: Array<(status: BackendGatewayStatus) => void> = [];

  beforeEach(() => {
    resetBackendStatusServiceForTests();
    listeners = [];
    (window as unknown as Record<string, unknown>).appShell = {
      onBackendStatusChanged: vi.fn((listener: (status: BackendGatewayStatus) => void) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        };
      })
    };
  });

  afterEach(() => {
    resetBackendStatusServiceForTests();
  });

  it("subscribes to shell backend status events", () => {
    const service = getBackendStatusService();
    expect(window.appShell.onBackendStatusChanged).toHaveBeenCalled();
    expect(service.getCurrentStatus()).toBeNull();
  });

  it("notifies listeners when status changes", () => {
    const service = getBackendStatusService();
    const received: BackendGatewayStatus[] = [];
    service.subscribe((status) => received.push(status));

    const status: BackendGatewayStatus = {
      mode: "mock-stdio",
      state: "healthy",
      supportedCapabilities: [],
      activeExecutionIds: [],
      recentExecutions: [],
      backendLogs: [],
      tracePayloads: false
    };

    for (const listener of listeners) {
      listener(status);
    }

    expect(received).toHaveLength(1);
    expect(received[0].state).toBe("healthy");
    expect(service.getCurrentStatus()?.state).toBe("healthy");
  });

  it("allows unsubscribing", () => {
    const service = getBackendStatusService();
    const received: BackendGatewayStatus[] = [];
    const unsubscribe = service.subscribe((status) => received.push(status));

    unsubscribe();

    const status: BackendGatewayStatus = {
      mode: "mock-stdio",
      state: "healthy",
      supportedCapabilities: [],
      activeExecutionIds: [],
      recentExecutions: [],
      backendLogs: [],
      tracePayloads: false
    };

    for (const listener of listeners) {
      listener(status);
    }

    expect(received).toHaveLength(0);
  });
});
