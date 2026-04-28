import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryEngineService } from "./QueryEngineService";

describe("QueryEngineService backend readiness", () => {
  const originalAppShell = window.appShell;

  afterEach(() => {
    window.appShell = originalAppShell;
    vi.restoreAllMocks();
  });

  it("blocks invoke when backend is not healthy", async () => {
    const invokeBackendEngine = vi.fn(async () => ({ result: { ok: true } }));
    window.appShell = {
      ...originalAppShell,
      getBackendStatus: async () => ({
        mode: "mock-stdio",
        state: "starting",
        supportedCapabilities: [],
        activeExecutionIds: [],
        recentExecutions: [],
        backendLogs: []
      }),
      invokeBackendEngine
    };

    const service = new QueryEngineService();

    await expect(
      service.invoke({
        engineId: "payloadbuilder",
        action: "test.action",
        payload: {}
      })
    ).rejects.toThrow("Backend is not up and running yet");

    expect(invokeBackendEngine).not.toHaveBeenCalled();
  });

  it("allows invoke when backend is healthy", async () => {
    const invokeBackendEngine = vi.fn(async () => ({ result: { ok: true } }));
    window.appShell = {
      ...originalAppShell,
      getBackendStatus: async () => ({
        mode: "mock-stdio",
        state: "healthy",
        supportedCapabilities: [],
        activeExecutionIds: [],
        recentExecutions: [],
        backendLogs: []
      }),
      invokeBackendEngine
    };

    const service = new QueryEngineService();
    const result = await service.invoke({
      engineId: "payloadbuilder",
      action: "test.action",
      payload: {}
    });

    expect(result).toEqual({ ok: true });
    expect(invokeBackendEngine).toHaveBeenCalledOnce();
  });
});
