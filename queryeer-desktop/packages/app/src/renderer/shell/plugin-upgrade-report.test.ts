import { describe, expect, it, vi } from "vitest";
import type { BackendGatewayStatus } from "@queryeer/api/backend";
import type { PluginDiagnostics } from "../../core/plugin-runtime/PluginDiagnostics";
import { describeUpgradeReport, observePluginLoads, watchPluginUpgrade } from "./plugin-upgrade-report";

const diagnostics: PluginDiagnostics = {
  discoveredManifestIds: ["active", "skipped", "inactive"],
  activationOrder: ["active"],
  providedCapabilities: [],
  pluginManifests: [],
  pluginProblems: [
    { pluginId: "skipped", state: "skipped", message: "Missing dependency: core.queryengine.jdbc" },
    { pluginId: "active", state: "warning", message: "Slow to activate" }
  ],
  externalLoadErrors: [{ pluginId: "incompatible", modulePath: "/p/index.js", message: "Needs Queryeer >=0.25.0, but this is 0.24.0", skipped: true }]
};

describe("observePluginLoads", () => {
  it("combines the frontends the host activated with the backend's statuses", () => {
    const observed = observePluginLoads(diagnostics, [
      { pluginId: "active", state: "activated" },
      { pluginId: "backend-only", state: "failed", reason: "Needs Java 26, but Queryeer's backend runs on Java 25" },
      { pluginId: "loaded-only", state: "loaded" }
    ]);

    expect(observed).toEqual([
      { pluginId: "active", frontend: { loaded: true }, backend: { loaded: true } },
      { pluginId: "skipped", frontend: { loaded: false, reason: "Missing dependency: core.queryengine.jdbc" } },
      { pluginId: "inactive", frontend: { loaded: false, reason: "Its frontend wasn't activated" } },
      { pluginId: "incompatible", frontend: { loaded: false, reason: "Needs Queryeer >=0.25.0, but this is 0.24.0" } },
      { pluginId: "backend-only", backend: { loaded: false, reason: "Needs Java 26, but Queryeer's backend runs on Java 25" } },
      { pluginId: "loaded-only", backend: { loaded: false, reason: "Its backend is loaded" } }
    ]);
  });
});

describe("describeUpgradeReport", () => {
  it("names the versions and each plugin with its reason", () => {
    const open = vi.fn();
    const notification = describeUpgradeReport(
      {
        appVersion: "0.25.0",
        previousVersion: "0.24.0",
        plugins: [
          { pluginId: "com.example.one", name: "One", reason: "Needs Java 26" },
          { pluginId: "com.example.two", reason: "Its bundled version 1.0.0 wasn't installed: broken" }
        ]
      },
      open
    );

    expect(notification).toMatchObject({
      title: "After updating from Queryeer 0.24.0 to 0.25.0, 2 plugins need attention",
      message: "One (com.example.one): Needs Java 26\ncom.example.two: Its bundled version 1.0.0 wasn't installed: broken",
      severity: "warning"
    });
    notification.actions?.[0].run();
    expect(open).toHaveBeenCalled();
    expect(describeUpgradeReport({ appVersion: "0.24.0", plugins: [{ pluginId: "x", reason: "r" }] }, open).title).toBe("After updating to Queryeer 0.24.0, a plugin needs attention");
  });
});

describe("watchPluginUpgrade", () => {
  const withRuntime: BackendGatewayStatus = {
    state: "ready",
    runtimeStatus: { startedAt: "t1", pluginStatuses: [{ pluginId: "a", state: "activated" }] }
  } as unknown as BackendGatewayStatus;

  it("records once the backend has reported its plugins, and notifies about a report", async () => {
    let listener: ((status: BackendGatewayStatus) => void) | undefined;
    const recordPluginLoads = vi.fn(async () => ({ appVersion: "0.25.0", plugins: [{ pluginId: "a", reason: "r" }] }));
    const notify = vi.fn();
    watchPluginUpgrade({
      getStatus: async () => ({ state: "starting" }) as unknown as BackendGatewayStatus,
      onStatusChanged: (next) => {
        listener = next;
        return () => {
          listener = undefined;
        };
      },
      getDiagnostics: () => diagnostics,
      recordPluginLoads,
      notify,
      openObservability: vi.fn()
    });
    await Promise.resolve();
    expect(recordPluginLoads).not.toHaveBeenCalled();

    listener?.(withRuntime);
    listener?.(withRuntime);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));

    expect(recordPluginLoads).toHaveBeenCalledTimes(1);
    expect(listener).toBeUndefined();
  });

  it("doesn't notify when there is nothing to report", async () => {
    const recordPluginLoads = vi.fn(async () => null);
    const notify = vi.fn();
    watchPluginUpgrade({
      getStatus: async () => withRuntime,
      onStatusChanged: () => () => undefined,
      getDiagnostics: () => diagnostics,
      recordPluginLoads,
      notify,
      openObservability: vi.fn()
    });

    await vi.waitFor(() => expect(recordPluginLoads).toHaveBeenCalledTimes(1));
    expect(notify).not.toHaveBeenCalled();
  });

  it("hands the report to onReport before showing it, records once when both the status and a listener carry it", async () => {
    const order: string[] = [];
    const recordPluginLoads = vi.fn(async () => ({ appVersion: "0.25.0", plugins: [{ pluginId: "a", reason: "r" }] }));
    watchPluginUpgrade({
      getStatus: async () => withRuntime,
      // Calls the listener at once, before getStatus resolves
      onStatusChanged: (listener) => {
        listener(withRuntime);
        return () => undefined;
      },
      getDiagnostics: () => diagnostics,
      recordPluginLoads,
      onReport: () => order.push("onReport"),
      notify: () => order.push("notify"),
      openObservability: vi.fn()
    });

    await vi.waitFor(() => expect(order).toEqual(["onReport", "notify"]));
    expect(recordPluginLoads).toHaveBeenCalledTimes(1);
  });

  it("doesn't notify when recording fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const recordPluginLoads = vi.fn(async () => {
      throw new Error("ipc gone");
    });
    const notify = vi.fn();
    watchPluginUpgrade({
      getStatus: async () => withRuntime,
      onStatusChanged: () => () => undefined,
      getDiagnostics: () => diagnostics,
      recordPluginLoads,
      notify,
      openObservability: vi.fn()
    });

    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    expect(notify).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
