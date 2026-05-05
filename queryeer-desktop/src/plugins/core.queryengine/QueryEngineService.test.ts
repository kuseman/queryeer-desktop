import { BackendNotReadyError } from "../../contracts/backend/BackendNotReadyError";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryEngineService } from "./QueryEngineService";

const securityMocks = vi.hoisted(() => ({
  getCoreSecurityServiceMock: vi.fn<() => unknown>(() => null)
}));

vi.mock("../core.security/service", () => ({
  getCoreSecurityService: securityMocks.getCoreSecurityServiceMock
}));

describe("QueryEngineService backend readiness", () => {
  const originalAppShell = window.appShell;

  afterEach(() => {
    window.appShell = originalAppShell;
    securityMocks.getCoreSecurityServiceMock.mockReset();
    securityMocks.getCoreSecurityServiceMock.mockReturnValue(null);
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

    await expect(
      service.invoke({
        engineId: "payloadbuilder",
        action: "test.action",
        payload: {}
      })
    ).rejects.toBeInstanceOf(BackendNotReadyError);

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

  it("retries invoke after vault unlock when backend returns SECURITY_SESSION_CLOSED", async () => {
    const invokeBackendEngine = vi.fn(async () => {
      const callCount = invokeBackendEngine.mock.calls.length;
      if (callCount === 1) {
        return { error: { code: "SECURITY_SESSION_CLOSED", message: "Security session is not open" } };
      }
      return { result: { ok: true } };
    });
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

    const withVaultRetry = vi.fn(async (operation: () => Promise<unknown>) => {
      try {
        return await operation();
      } catch (error) {
        if (error instanceof Error && error.message.includes("SECURITY_SESSION_CLOSED")) {
          return await operation();
        }
        throw error;
      }
    });
    securityMocks.getCoreSecurityServiceMock.mockReturnValue({
      withVaultRetry
    } as unknown as ReturnType<typeof securityMocks.getCoreSecurityServiceMock>);

    const service = new QueryEngineService();
    const result = await service.invoke({
      engineId: "payloadbuilder",
      action: "test.action",
      payload: {}
    });

    expect(result).toEqual({ ok: true });
    expect(invokeBackendEngine).toHaveBeenCalledTimes(2);
  });

  it("throws when vault unlock is cancelled during invoke SECURITY_SESSION_CLOSED", async () => {
    const invokeBackendEngine = vi.fn(async () => ({
      error: { code: "SECURITY_SESSION_CLOSED", message: "Security session is not open" }
    }));
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

    const withVaultRetry = vi.fn(async (operation: () => Promise<unknown>) => {
      try {
        return await operation();
      } catch {
        throw new Error("Security vault is locked");
      }
    });
    securityMocks.getCoreSecurityServiceMock.mockReturnValue({
      withVaultRetry
    } as unknown as ReturnType<typeof securityMocks.getCoreSecurityServiceMock>);

    const service = new QueryEngineService();

    await expect(
      service.invoke({
        engineId: "payloadbuilder",
        action: "test.action",
        payload: {}
      })
    ).rejects.toThrow("Security vault is locked");

    expect(invokeBackendEngine).toHaveBeenCalledTimes(1);
  });

  it("emits queryengine.failed and clears state when unlock fails during execute", async () => {
    const executeBackendQuery = vi.fn(async () => ({ accepted: true, queryExecutionId: "q-backend" }));
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
      executeBackendQuery
    };

    const withVaultRetry = vi.fn(async (_operation: () => Promise<unknown>) => {
      throw new Error("Security vault is locked");
    });
    securityMocks.getCoreSecurityServiceMock.mockReturnValue({
      withVaultRetry
    } as unknown as ReturnType<typeof securityMocks.getCoreSecurityServiceMock>);

    const service = new QueryEngineService();
    const events: Array<{ method: string; params?: unknown; contextFileId?: string }> = [];
    service.onQueryEvent((event, context) => {
      events.push({ method: event.method, params: event.params, contextFileId: context?.fileId });
    });

    await expect(
      service.execute({
        engineId: "payloadbuilder",
        fileId: "file-1",
        text: "select * from t",
        engineState: { secretRef: "vault://x" }
      })
    ).rejects.toThrow("Security vault is locked");

    expect(executeBackendQuery).not.toHaveBeenCalled();
    expect(events[0]).toEqual(
      expect.objectContaining({
        method: "query.started",
        contextFileId: "file-1"
      })
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        method: "queryengine.failed",
        contextFileId: "file-1"
      })
    );

    const failedParams = events[1]?.params as { error?: { code?: string; message?: string } };
    expect(failedParams.error?.code).toBe("EXECUTE_ERROR");
    expect(failedParams.error?.message).toContain("Security vault is locked");
  });
});
