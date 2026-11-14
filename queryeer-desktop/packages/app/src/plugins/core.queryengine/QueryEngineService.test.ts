import { BackendNotReadyError } from "@queryeer/api/backend/BackendNotReadyError";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryEngineService, EXECUTE_REQUEST_TTL_MS } from "./QueryEngineService";

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

  it("emits local cancellation even when the backend becomes unavailable", async () => {
    let healthy = true;
    window.appShell = {
      ...originalAppShell,
      getBackendStatus: async () => ({
        mode: "mock-stdio",
        state: healthy ? "healthy" : "unavailable",
        supportedCapabilities: [],
        activeExecutionIds: [],
        recentExecutions: [],
        backendLogs: []
      }),
      executeBackendQuery: vi.fn(async (params) => ({ accepted: true, queryExecutionId: params.queryExecutionId })),
      cancelBackendQuery: vi.fn()
    };
    const service = new QueryEngineService();
    const events: string[] = [];
    service.onQueryEvent((event) => events.push(event.method));
    const executionId = await service.execute({ engineId: "jdbc", fileId: "file-1", text: "select 1" });
    healthy = false;

    await expect(service.cancel(executionId)).rejects.toBeInstanceOf(BackendNotReadyError);
    expect(events).toContain("queryengine.failed");
  });

  it("consumes execute options for matching output session id", () => {
    const service = new QueryEngineService();

    service.requestExecute({
      textOverride: "select 1",
      targetOutputSessionId: "session-a"
    });

    expect(service.consumeExecuteOptions({
      fileId: "file-1",
      targetOutputSessionId: "session-b",
      isActiveEditorGroup: true
    })).toBeNull();

    const consumed = service.consumeExecuteOptions({
      fileId: "file-1",
      targetOutputSessionId: "session-a",
      isActiveEditorGroup: false
    });
    expect(consumed).toEqual(expect.objectContaining({
      textOverride: "select 1",
      targetOutputSessionId: "session-a"
    }));
    expect(service.peekExecuteOptions()).toBeNull();
  });

  it("drops a request aimed at a file that no editor takes in time", () => {
    vi.useFakeTimers();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const service = new QueryEngineService();

      service.requestExecute({ fileIdOverride: "file-1", textOverride: "select 1" });
      vi.advanceTimersByTime(EXECUTE_REQUEST_TTL_MS - 1);
      expect(service.peekExecuteOptions()).toEqual(expect.objectContaining({ fileIdOverride: "file-1" }));

      vi.advanceTimersByTime(2);
      expect(service.peekExecuteOptions()).toBeNull();
      expect(debug).toHaveBeenCalledWith(expect.stringContaining("file-1"));
      expect(service.consumeExecuteOptions({ fileId: "file-1", isActiveEditorGroup: true })).toBeNull();

      // Untargeted requests get the same limit as a backstop, so one nobody took can't fire later.
      service.requestExecute({ textOverride: "select 2" });
      vi.advanceTimersByTime(EXECUTE_REQUEST_TTL_MS - 1);
      expect(service.peekExecuteOptions()).toEqual(expect.objectContaining({ textOverride: "select 2" }));
      vi.advanceTimersByTime(2);
      expect(service.peekExecuteOptions()).toBeNull();
    } finally {
      vi.useRealTimers();
      debug.mockRestore();
    }
  });

  it("keeps a held request past the expiry until its editor takes it", () => {
    vi.useFakeTimers();
    try {
      const service = new QueryEngineService();

      service.requestExecute({ fileIdOverride: "file-1", textOverride: "select 1" });
      // The editor showing file-1 defers it while another run is starting, e.g. behind a vault prompt.
      service.holdExecuteRequest("file-1");
      vi.advanceTimersByTime(EXECUTE_REQUEST_TTL_MS * 3);

      expect(service.consumeExecuteOptions({ fileId: "file-1", isActiveEditorGroup: true }))
        .toEqual(expect.objectContaining({ fileIdOverride: "file-1", textOverride: "select 1" }));

      // Holding only applies to the file the request is aimed at.
      service.requestExecute({ fileIdOverride: "file-2" });
      service.holdExecuteRequest("file-other");
      vi.advanceTimersByTime(EXECUTE_REQUEST_TTL_MS + 1);
      const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
      expect(service.peekExecuteOptions()).toBeNull();
      debug.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("discards a turned-down request only while it is still the pending one", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const service = new QueryEngineService();

      const first = { textOverride: "select 1" };
      service.requestExecute(first);
      service.discardExecuteRequest(first);
      expect(service.peekExecuteOptions()).toBeNull();

      const replaced = { textOverride: "select 2" };
      const current = { textOverride: "select 3" };
      service.requestExecute(replaced);
      service.requestExecute(current);
      service.discardExecuteRequest(replaced);
      expect(service.peekExecuteOptions()).toBe(current);
    } finally {
      debug.mockRestore();
    }
  });

  it("restarts the time limit of a held request when it is released", () => {
    vi.useFakeTimers();
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      const service = new QueryEngineService();

      service.requestExecute({ fileIdOverride: "file-1" });
      service.holdExecuteRequest("file-1");
      vi.advanceTimersByTime(EXECUTE_REQUEST_TTL_MS * 3);
      service.releaseExecuteRequest("file-1");

      vi.advanceTimersByTime(EXECUTE_REQUEST_TTL_MS - 1);
      expect(service.peekExecuteOptions()).toEqual(expect.objectContaining({ fileIdOverride: "file-1" }));
      vi.advanceTimersByTime(2);
      expect(service.peekExecuteOptions()).toBeNull();

      // Releasing a request that was never held doesn't extend its time limit.
      service.requestExecute({ fileIdOverride: "file-2" });
      vi.advanceTimersByTime(EXECUTE_REQUEST_TTL_MS - 1);
      service.releaseExecuteRequest("file-2");
      vi.advanceTimersByTime(2);
      expect(service.peekExecuteOptions()).toBeNull();
    } finally {
      vi.useRealTimers();
      debug.mockRestore();
    }
  });

  it("does not consume generic execute options from inactive group", () => {
    const service = new QueryEngineService();

    service.requestExecute({ textOverride: "select 2" });

    expect(service.consumeExecuteOptions({
      fileId: "file-1",
      isActiveEditorGroup: false
    })).toBeNull();

    const consumed = service.consumeExecuteOptions({
      fileId: "file-1",
      isActiveEditorGroup: true
    });
    expect(consumed).toEqual(expect.objectContaining({ textOverride: "select 2" }));
    expect(service.peekExecuteOptions()).toBeNull();
  });

  it("buffers events arriving before subscribe and replays them", async () => {
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

    const service = new QueryEngineService();
    service.initialize();

    const executionId = await service.execute({
      engineId: "jdbc",
      fileId: "file-1",
      text: "select * from t"
    });

    // Send events before subscribe() is called — they should be buffered
    const listener = [...queryListeners][0];
    listener?.({
      method: "queryengine.chunkStart",
      params: { queryExecutionId: executionId, resultSetIndex: 0, schema: { columns: [{ name: "id", type: "integer" }] } }
    });
    listener?.({
      method: "queryengine.chunkRows",
      params: { queryExecutionId: executionId, resultSetIndex: 0, rows: [[1], [2]] }
    });
    listener?.({
      method: "queryengine.completed",
      params: { queryExecutionId: executionId, metrics: { durationMs: 10, rowCount: 2 } }
    });

    // Now subscribe — should receive the buffered events
    const received: Array<{ method: string }> = [];
    service.subscribe(executionId, (event) => {
      received.push({ method: event.method });
    });

    expect(received).toEqual([
      { method: "queryengine.chunkStart" },
      { method: "queryengine.chunkRows" },
      { method: "queryengine.completed" }
    ]);
  });
});
