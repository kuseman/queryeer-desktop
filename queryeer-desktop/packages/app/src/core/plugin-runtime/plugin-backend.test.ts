import { BackendNotReadyError } from "@queryeer/api/backend/BackendNotReadyError";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPluginBackend } from "./plugin-backend";

const securityMocks = vi.hoisted(() => ({
  getCoreSecurityServiceMock: vi.fn<() => unknown>(() => null)
}));

vi.mock("../../plugins/core.security/service", () => ({
  getCoreSecurityService: securityMocks.getCoreSecurityServiceMock
}));

function status(state: "healthy" | "starting") {
  return async () => ({
    mode: "mock-stdio" as const,
    state,
    supportedCapabilities: [],
    activeExecutionIds: [],
    recentExecutions: [],
    backendLogs: []
  });
}

/** The core tests run in node: a window holding only the shell calls plugin-backend uses. */
function stubShell(appShell: Partial<Window["appShell"]>): void {
  vi.stubGlobal("window", { appShell });
}

describe("createPluginBackend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    securityMocks.getCoreSecurityServiceMock.mockReset();
    securityMocks.getCoreSecurityServiceMock.mockReturnValue(null);
    vi.restoreAllMocks();
  });

  it("calls the plugin's own backend action and resolves to its result", async () => {
    const invokeBackendPlugin = vi.fn(async () => ({ result: { topics: ["orders"] } }));
    stubShell({ getBackendStatus: status("healthy"), invokeBackendPlugin });

    const result = await createPluginBackend("com.example.kafka").invoke<{ topics: string[] }>("topics.list", { connectionId: "local" });

    expect(result).toEqual({ topics: ["orders"] });
    expect(invokeBackendPlugin).toHaveBeenCalledWith({ pluginId: "com.example.kafka", action: "topics.list", payload: { connectionId: "local" } }, undefined);
  });

  it("passes a timeout on", async () => {
    const invokeBackendPlugin = vi.fn(async () => ({ result: null }));
    stubShell({ getBackendStatus: status("healthy"), invokeBackendPlugin });

    await expect(createPluginBackend("com.example.kafka").invoke("topics.list", undefined, { timeoutMs: 30_000 })).resolves.toBeUndefined();
    expect(invokeBackendPlugin).toHaveBeenCalledWith({ pluginId: "com.example.kafka", action: "topics.list" }, { timeoutMs: 30_000 });
  });

  it("rejects with the backend's message", async () => {
    const invokeBackendPlugin = vi.fn(async () => ({ error: { code: "VALIDATION", message: "Kafka connection 'x' was not found" } }));
    stubShell({ getBackendStatus: status("healthy"), invokeBackendPlugin });

    const rejection = createPluginBackend("com.example.kafka").invoke("topics.list");
    await expect(rejection).rejects.toThrow("Kafka connection 'x' was not found");
    await expect(rejection).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects without calling while the backend isn't up", async () => {
    const invokeBackendPlugin = vi.fn(async () => ({ result: {} }));
    stubShell({ getBackendStatus: status("starting"), invokeBackendPlugin });

    await expect(createPluginBackend("com.example.kafka").invoke("topics.list")).rejects.toBeInstanceOf(BackendNotReadyError);
    expect(invokeBackendPlugin).not.toHaveBeenCalled();
  });

  it("retries through the vault when the security session is closed, asking only when not silent", async () => {
    const invokeBackendPlugin = vi
      .fn()
      .mockResolvedValueOnce({ error: { code: "SECURITY_SESSION_CLOSED", message: "Vault locked" } })
      .mockResolvedValueOnce({ result: "ok" });
    const withVaultRetry = vi.fn(async (operation: () => Promise<unknown>, options: { interactive: boolean }) => {
      try {
        return await operation();
      } catch (error) {
        expect(String(error)).toContain("SECURITY_SESSION_CLOSED");
        expect(options.interactive).toBe(false);
        return await operation();
      }
    });
    securityMocks.getCoreSecurityServiceMock.mockReturnValue({ withVaultRetry });
    stubShell({ getBackendStatus: status("healthy"), invokeBackendPlugin });

    await expect(createPluginBackend("com.example.kafka").invoke("connection.test", {}, { silent: true })).resolves.toBe("ok");
    expect(invokeBackendPlugin).toHaveBeenCalledTimes(2);
  });
});
