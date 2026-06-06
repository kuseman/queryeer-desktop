import { BackendNotReadyError } from "@queryeer/api/backend/BackendNotReadyError";
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

  it("passes interactive: false to withVaultRetry when invoke is called with silent: true", async () => {
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

    const withVaultRetry = vi.fn(async (operation: () => Promise<unknown>) => {
      return operation();
    });
    securityMocks.getCoreSecurityServiceMock.mockReturnValue({
      withVaultRetry
    } as unknown as ReturnType<typeof securityMocks.getCoreSecurityServiceMock>);

    const service = new QueryEngineService();
    await service.invoke(
      { engineId: "payloadbuilder", action: "test.action", payload: {} },
      { silent: true }
    );

    expect(withVaultRetry).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ interactive: false })
    );
  });

  it("decorates object invoke payloads with execution context provider engineState", async () => {
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
    service.registerExecutionContextProvider((params) => {
      if (params.engineId !== "payloadbuilder") {
        return undefined;
      }
      return { engineState: { payloadbuilder: { catalogs: { fake: { catalogId: "example.fake" } } } } };
    });

    await service.invoke({
      engineId: "payloadbuilder",
      fileId: "file-1",
      action: "sql.complete",
      payload: { text: "select * from ", cursor: { line: 1, column: 15 } }
    });

    expect(invokeBackendEngine).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        engineState: { payloadbuilder: { catalogs: { fake: { catalogId: "example.fake" } } } }
      })
    }));
  });

  it("does not overwrite explicit invoke payload engineState", async () => {
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
    service.registerExecutionContextProvider(() => ({
      engineState: { payloadbuilder: { catalogs: { fromProvider: { catalogId: "provider" } } } }
    }));

    const explicitState = { payloadbuilder: { catalogs: { explicit: { catalogId: "explicit" } } } };
    await service.invoke({
      engineId: "payloadbuilder",
      fileId: "file-1",
      action: "sql.hover",
      payload: { text: "select * from fake.products", cursor: { line: 1, column: 20 }, engineState: explicitState }
    });

    expect(invokeBackendEngine).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ engineState: explicitState })
    }));
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

  it("retries executeAndCollect after vault unlock on SECURITY_SESSION_CLOSED", async () => {
    const queryListeners = new Set<(event: { method: string; params: unknown }) => void>();
    const onQueryEvent = vi.fn((listener: (event: { method: string; params: unknown }) => void) => {
      queryListeners.add(listener);
      return () => {
        queryListeners.delete(listener);
      };
    });
    const executeBackendQuery = vi.fn(async (params: { queryExecutionId: string }) => ({
      accepted: true,
      queryExecutionId: params.queryExecutionId
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
      executeBackendQuery,
      onQueryEvent
    };

    const ensureUnlockedForSecretAccess = vi.fn(async () => true);
    const withVaultRetry = vi.fn(async (operation: () => Promise<unknown>) => operation());
    securityMocks.getCoreSecurityServiceMock.mockReturnValue({
      ensureUnlockedForSecretAccess,
      withVaultRetry
    } as unknown as ReturnType<typeof securityMocks.getCoreSecurityServiceMock>);

    const service = new QueryEngineService();
    service.initialize();

    const collected = service.executeAndCollect({
      engineId: "jdbc",
      fileId: "flow-1",
      text: "select 1"
    });

    await vi.waitFor(() => {
      expect(executeBackendQuery).toHaveBeenCalledTimes(1);
    });
    const firstExecutionId = (
      executeBackendQuery.mock.calls[0]?.[0] as { queryExecutionId: string }
    ).queryExecutionId;
    const listener = [...queryListeners][0];
    expect(listener).toBeTruthy();

    listener?.({
      method: "queryengine.failed",
      params: {
        queryExecutionId: firstExecutionId,
        error: {
          code: "SECURITY_SESSION_CLOSED",
          message: "Security session is not open"
        }
      }
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(ensureUnlockedForSecretAccess).toHaveBeenCalledWith({ interactive: true });
    await vi.waitFor(() => {
      expect(executeBackendQuery).toHaveBeenCalledTimes(2);
    });

    const secondExecutionId = (
      executeBackendQuery.mock.calls[1]?.[0] as { queryExecutionId: string }
    ).queryExecutionId;

    listener?.({
      method: "queryengine.chunkStart",
      params: {
        queryExecutionId: secondExecutionId,
        resultSetIndex: 0,
        schema: {
          columns: [{ name: "id", type: "int" }]
        }
      }
    });
    listener?.({
      method: "queryengine.chunkRows",
      params: {
        queryExecutionId: secondExecutionId,
        resultSetIndex: 0,
        rows: [[1]]
      }
    });
    listener?.({
      method: "queryengine.completed",
      params: {
        queryExecutionId: secondExecutionId
      }
    });

    await expect(collected).resolves.toEqual({
      resultSets: [
        {
          schema: {
            columns: [{ name: "id", type: "int" }]
          },
          rows: [[1]]
        }
      ]
    });
  });

  it("fails executeAndCollect when unlock is cancelled after SECURITY_SESSION_CLOSED", async () => {
    const queryListeners = new Set<(event: { method: string; params: unknown }) => void>();
    const onQueryEvent = vi.fn((listener: (event: { method: string; params: unknown }) => void) => {
      queryListeners.add(listener);
      return () => {
        queryListeners.delete(listener);
      };
    });
    const executeBackendQuery = vi.fn(async (params: { queryExecutionId: string }) => ({
      accepted: true,
      queryExecutionId: params.queryExecutionId
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
      executeBackendQuery,
      onQueryEvent
    };

    const ensureUnlockedForSecretAccess = vi.fn(async () => false);
    const withVaultRetry = vi.fn(async (operation: () => Promise<unknown>) => operation());
    securityMocks.getCoreSecurityServiceMock.mockReturnValue({
      ensureUnlockedForSecretAccess,
      withVaultRetry
    } as unknown as ReturnType<typeof securityMocks.getCoreSecurityServiceMock>);

    const service = new QueryEngineService();
    service.initialize();

    const collected = service.executeAndCollect({
      engineId: "jdbc",
      fileId: "flow-1",
      text: "select 1"
    });

    await vi.waitFor(() => {
      expect(executeBackendQuery).toHaveBeenCalledTimes(1);
    });
    const executionId = (
      executeBackendQuery.mock.calls[0]?.[0] as { queryExecutionId: string }
    ).queryExecutionId;
    const listener = [...queryListeners][0];
    expect(listener).toBeTruthy();

    listener?.({
      method: "queryengine.failed",
      params: {
        queryExecutionId: executionId,
        error: {
          code: "SECURITY_SESSION_CLOSED",
          message: "Security session is not open"
        }
      }
    });

    await expect(collected).rejects.toThrow("Security vault is locked");
    expect(ensureUnlockedForSecretAccess).toHaveBeenCalledWith({ interactive: true });
    expect(executeBackendQuery).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite explicit engineState with execution context provider state", async () => {
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

    const service = new QueryEngineService();
    service.registerExecutionContextProvider(() => ({
      engineState: { connectionId: "from-provider" },
      options: { timeoutMs: 5000 }
    }));

    await service.execute({
      engineId: "jdbc",
      fileId: "flow-1",
      text: "select 1",
      engineState: { refs: { connection: "orders-main" } }
    });

    expect(executeBackendQuery).toHaveBeenCalledWith(expect.objectContaining({
      engineState: { refs: { connection: "orders-main" } },
      options: { timeoutMs: 5000 }
    }));
  });

  it("emits a terminal cancelled event immediately after cancel", async () => {
    const executeBackendQuery = vi.fn(async () => ({ accepted: true, queryExecutionId: "exec-1" }));
    const cancelBackendQuery = vi.fn(async () => ({ accepted: true, queryExecutionId: "exec-1" }));
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
      executeBackendQuery,
      cancelBackendQuery
    };

    const service = new QueryEngineService();
    const events: Array<{ method: string; params?: unknown; contextFileId?: string }> = [];
    service.onQueryEvent((event, context) => {
      events.push({ method: event.method, params: event.params, contextFileId: context?.fileId });
    });

    const executionId = await service.execute({
      engineId: "jdbc",
      fileId: "file-1",
      text: "select * from t"
    });
    await service.cancel(executionId);

    expect(cancelBackendQuery).toHaveBeenCalledWith({ queryExecutionId: executionId });
    const cancelled = events.find((event) => event.method === "queryengine.failed");
    expect(cancelled).toEqual(expect.objectContaining({ contextFileId: "file-1" }));
    const failedParams = cancelled?.params as { error?: { code?: string; message?: string } };
    expect(failedParams.error?.code).toBe("CANCELLED");
  });
});
