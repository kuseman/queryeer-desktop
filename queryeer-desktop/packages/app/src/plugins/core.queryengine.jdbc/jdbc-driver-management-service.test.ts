import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationService } from "@queryeer/api/extensions/NotificationExtension";
import type {
  JdbcDriverStatus,
  RegisteredJdbcManagedDriverContribution
} from "@queryeer/api/queryengine/JdbcDriverExtension";
import {
  JDBC_DRIVER_CHECK_INTERVAL_MS,
  JdbcDriverManagementService,
  type JdbcDriverManagementOptions
} from "./jdbc-driver-management-service";

const sqlite: RegisteredJdbcManagedDriverContribution = {
  ownerPluginId: "core.queryengine.jdbc.sqlite",
  dialectId: "sqlite",
  displayName: "SQLite JDBC Driver",
  groupId: "org.xerial",
  artifactId: "sqlite-jdbc",
  driverClassName: "org.sqlite.JDBC"
};

function status(overrides: Partial<JdbcDriverStatus> = {}): JdbcDriverStatus {
  return {
    contribution: sqlite,
    source: "missing",
    updateAvailable: false,
    restartRequired: false,
    managementAvailable: true,
    ...overrides
  };
}

function notifications(): NotificationService {
  return {
    notify: vi.fn((request) => ({
      ...request,
      id: "notice",
      severity: request.severity ?? "info",
      createdAt: new Date().toISOString(),
      read: false,
      toastDismissed: false
    })),
    list: vi.fn(() => []),
    unreadCount: vi.fn(() => 0),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
    dismissToast: vi.fn(),
    clear: vi.fn(),
    clearAll: vi.fn(),
    subscribe: vi.fn(() => () => {})
  };
}

function options(overrides: Partial<JdbcDriverManagementOptions> = {}): JdbcDriverManagementOptions {
  const missing = status();
  return {
    contributions: [sqlite],
    shell: {
      listJdbcDrivers: vi.fn(async () => [missing]),
      checkJdbcDrivers: vi.fn(async () => [missing]),
      installJdbcDriver: vi.fn(async () => ({ accepted: true, status: missing })),
      updateJdbcDriver: vi.fn(async () => ({ accepted: true, status: missing })),
      removeJdbcDriver: vi.fn(async () => ({ accepted: true, status: missing })),
      restoreJdbcDriver: vi.fn(async () => ({ accepted: true, status: missing })),
      discardJdbcDriverRetainedSet: vi.fn(async () => ({ accepted: true, status: missing })),
      restartBackendForJdbcDrivers: vi.fn(async () => ({ accepted: true }))
    },
    notifications: notifications(),
    openSettings: vi.fn(),
    confirmOperation: vi.fn(async () => true),
    updateChecksEnabled: () => true,
    persistedConnections: () => [],
    storage: localStorage,
    windowTarget: window,
    documentTarget: document,
    ...overrides
  };
}

describe("JdbcDriverManagementService", () => {
  let service: JdbcDriverManagementService;

  beforeEach(() => {
    localStorage.clear();
    service = new JdbcDriverManagementService();
  });

  afterEach(() => {
    service.reset();
    vi.useRealTimers();
  });

  it("checks immediately and recursively every 24 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const setup = options();

    await service.initialize(setup);
    expect(setup.shell.checkJdbcDrivers).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(JDBC_DRIVER_CHECK_INTERVAL_MS);
    expect(setup.shell.checkJdbcDrivers).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(JDBC_DRIVER_CHECK_INTERVAL_MS);
    expect(setup.shell.checkJdbcDrivers).toHaveBeenCalledTimes(3);
  });

  it("deduplicates automatic update notifications within the current session", async () => {
    const available = status({ source: "managed", installedVersion: "1.0", latestVersion: "2.0", updateAvailable: true });
    const setup = options({
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [available]),
        checkJdbcDrivers: vi.fn(async () => [available])
      }
    });

    await service.initialize(setup);
    await service.checkNow();

    expect(setup.notifications.notify).toHaveBeenCalledTimes(1);
    expect(setup.notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "SQLite JDBC Driver update available" }));
    const notification = vi.mocked(setup.notifications.notify).mock.calls[0][0];
    await notification.actions?.find((action) => action.label === "Open JDBC Drivers")?.run();
    expect(setup.openSettings).toHaveBeenCalledOnce();
  });

  it("notifies again when a manual check finds a previously announced update", async () => {
    const available = status({ source: "managed", installedVersion: "42.7.8", latestVersion: "42.7.13", updateAvailable: true });
    const setup = options({
      updateChecksEnabled: () => false,
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [available]),
        checkJdbcDrivers: vi.fn(async () => [available])
      }
    });
    await service.initialize(setup);
    await service.checkNow(true);
    await service.checkNow(true);

    const updateNotices = vi.mocked(setup.notifications.notify).mock.calls
      .map(([request]) => request)
      .filter((request) => request.title === "SQLite JDBC Driver update available");
    expect(updateNotices).toHaveLength(2);
  });

  it("shows a closed update notification again after an application restart", async () => {
    const available = status({ source: "managed", installedVersion: "42.7.8", latestVersion: "42.7.13", updateAvailable: true });
    const setup = options({
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [available]),
        checkJdbcDrivers: vi.fn(async () => [available])
      }
    });
    await service.initialize(setup);
    service.reset();
    await service.initialize(setup);

    const updateNotices = vi.mocked(setup.notifications.notify).mock.calls
      .map(([request]) => request)
      .filter((request) => request.title === "SQLite JDBC Driver update available");
    expect(updateNotices).toHaveLength(2);
  });

  it("persists suppression only when the user selects don't show again", async () => {
    const available = status({ source: "managed", installedVersion: "42.7.8", latestVersion: "42.7.13", updateAvailable: true });
    const setup = options({
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [available]),
        checkJdbcDrivers: vi.fn(async () => [available])
      }
    });
    await service.initialize(setup);
    const updateNotice = vi.mocked(setup.notifications.notify).mock.calls[0][0];
    await updateNotice.actions?.find((action) => action.label === "Don't show again for this version")?.run();
    service.reset();
    await service.initialize(setup);

    const updateNotices = vi.mocked(setup.notifications.notify).mock.calls
      .map(([request]) => request)
      .filter((request) => request.title === "SQLite JDBC Driver update available");
    expect(updateNotices).toHaveLength(1);
    expect(setup.notifications.clear).toHaveBeenCalledWith("notice");
  });

  it("installs an available update and restarts the backend from the notification", async () => {
    const available = status({ source: "managed", installedVersion: "42.7.8", latestVersion: "42.7.13", updateAvailable: true });
    const pending = status({
      source: "managed",
      installedVersion: "42.7.13",
      latestVersion: "42.7.13",
      updateAvailable: false,
      restartRequired: true,
      pendingOperation: "update"
    });
    const setup = options({
      updateChecksEnabled: () => false,
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn()
          .mockResolvedValueOnce([available])
          .mockResolvedValue([pending]),
        checkJdbcDrivers: vi.fn(async () => [available]),
        updateJdbcDriver: vi.fn(async () => ({ accepted: true, status: pending })),
        restartBackendForJdbcDrivers: vi.fn(async () => ({ accepted: true }))
      }
    });
    await service.initialize(setup);
    await service.checkNow(true);
    const updateNotice = vi.mocked(setup.notifications.notify).mock.calls
      .map(([request]) => request)
      .find((request) => request.title === "SQLite JDBC Driver update available");

    expect(updateNotice?.actions?.[0]?.label).toBe("Install and Restart Backend");
    await updateNotice?.actions?.[0]?.run();

    expect(setup.shell.updateJdbcDriver).toHaveBeenCalledWith(sqlite);
    expect(setup.notifications.clear).toHaveBeenCalledWith("notice");
    expect(setup.shell.restartBackendForJdbcDrivers).toHaveBeenCalledOnce();
    expect(setup.notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Backend restarted"
    }));
  });

  it("shows the SQLite migration notice once and only for persisted SQLite connections", async () => {
    const setup = options({
      updateChecksEnabled: () => false,
      persistedConnections: () => [{ connectionId: "sqlite-1", dialectId: "sqlite", properties: { file: "db.sqlite" } }]
    });
    await service.initialize(setup);
    service.reset();
    await service.initialize(setup);

    expect(setup.notifications.notify).toHaveBeenCalledTimes(1);
    expect(setup.notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "SQLite JDBC driver required" }));

    localStorage.clear();
    const withoutSqlite = options({ updateChecksEnabled: () => false });
    service.reset();
    await service.initialize(withoutSqlite);
    expect(withoutSqlite.notifications.notify).not.toHaveBeenCalled();
  });

  it("warns with the reason when active queries defer restart", async () => {
    const setup = options({
      updateChecksEnabled: () => false,
      shell: {
        ...options().shell,
        restartBackendForJdbcDrivers: vi.fn(async () => ({ accepted: false, reason: "2 active queries" }))
      }
    });
    await service.initialize(setup);
    await service.restartBackend();

    expect(setup.notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Backend restart deferred",
      message: "2 active queries",
      severity: "warning"
    }));
  });

  it("clears the restart-required notification before restarting", async () => {
    const pending = status({ source: "managed", restartRequired: true, pendingOperation: "install" });
    const setup = options({
      updateChecksEnabled: () => false,
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [pending]),
        installJdbcDriver: vi.fn(async () => ({ accepted: true, status: pending })),
        restartBackendForJdbcDrivers: vi.fn(async () => ({ accepted: true }))
      }
    });
    await service.initialize(setup);
    await service.install("sqlite");
    const restartNotice = vi.mocked(setup.notifications.notify).mock.calls
      .map(([request]) => request)
      .find((request) => request.title === "JDBC driver installed");

    await restartNotice?.actions?.[0]?.run();

    expect(setup.notifications.clear).toHaveBeenCalledWith("notice");
    expect(setup.shell.restartBackendForJdbcDrivers).toHaveBeenCalledOnce();
    expect(setup.notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Backend restarted"
    }));
  });

  it("does not invoke the main-process operation when core.dialog is cancelled", async () => {
    const setup = options({
      updateChecksEnabled: () => false,
      confirmOperation: vi.fn(async () => false)
    });
    await service.initialize(setup);

    const result = await service.install("sqlite");

    expect(result).toMatchObject({ accepted: false, reason: "JDBC driver operation cancelled" });
    expect(setup.shell.installJdbcDriver).not.toHaveBeenCalled();
  });

  it("targets and names a companion artifact independently", async () => {
    const native = {
      id: "native-auth",
      displayName: "Windows Native Authentication",
      kind: "nativeLibrary" as const,
      applicable: true,
      source: "missing" as const,
      updateAvailable: false,
      restartRequired: false,
      managementAvailable: true
    };
    const driverStatus = status({ artifacts: [{
      id: sqlite.artifactId,
      displayName: "JDBC JAR",
      kind: "driver",
      applicable: true,
      source: "missing",
      updateAvailable: false,
      restartRequired: false,
      managementAvailable: true
    }, native] });
    const setup = options({
      updateChecksEnabled: () => false,
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [driverStatus]),
        installJdbcDriver: vi.fn(async () => ({ accepted: true, status: driverStatus }))
      }
    });
    await service.initialize(setup);

    await service.install("sqlite", "native-auth");

    expect(setup.confirmOperation).toHaveBeenCalledWith("install", sqlite, native);
    expect(setup.shell.installJdbcDriver).toHaveBeenCalledWith(sqlite, "native-auth");
    expect(setup.notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Windows Native Authentication")
    }));
  });

  it("notifies and suppresses companion updates by artifact ID", async () => {
    const native = {
      id: "native-auth",
      displayName: "Windows Native Authentication",
      kind: "nativeLibrary" as const,
      applicable: true,
      source: "managed" as const,
      installedVersion: "12.6.0",
      latestVersion: "13.4.0",
      updateAvailable: true,
      restartRequired: false,
      managementAvailable: true
    };
    const available = status({ artifacts: [native] });
    const setup = options({
      updateChecksEnabled: () => false,
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [available]),
        checkJdbcDrivers: vi.fn(async () => [available])
      }
    });
    await service.initialize(setup);
    await service.checkNow(true);
    const notice = vi.mocked(setup.notifications.notify).mock.calls
      .map(([request]) => request)
      .find((request) => request.title.includes("Windows Native Authentication"));

    expect(notice?.actions?.map((action) => action.label)).toEqual([
      "Install and Restart Backend",
      "Open JDBC Drivers",
      "Don't show again for this version"
    ]);
    await notice?.actions?.[2].run();
    expect([...Array(localStorage.length)].map((_, index) => localStorage.key(index)))
      .toContain("queryeer.jdbcDrivers.suppressedUpdate.v2.sqlite.native-auth.13.4.0");
  });

  it("emits one package notification for a version-locked bundle", async () => {
    const primary = {
      id: sqlite.artifactId,
      displayName: "JDBC JAR",
      kind: "driver" as const,
      applicable: true,
      source: "managed" as const,
      installedVersion: "1.0.jre11",
      latestVersion: "2.0.jre11",
      updateAvailable: true,
      restartRequired: false,
      managementAvailable: true,
      managedWithPrimary: true
    };
    const native = {
      id: "native-auth",
      displayName: "Windows Native Authentication",
      kind: "nativeLibrary" as const,
      applicable: true,
      source: "managed" as const,
      installedVersion: "1.0",
      latestVersion: "2.0",
      updateAvailable: true,
      restartRequired: false,
      managementAvailable: true,
      managedWithPrimary: true
    };
    const available = status({ artifacts: [primary, native] });
    const setup = options({
      updateChecksEnabled: () => false,
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [available]),
        checkJdbcDrivers: vi.fn(async () => [available]),
        updateJdbcDriver: vi.fn(async () => ({ accepted: true, status: available }))
      }
    });
    await service.initialize(setup);
    await service.checkNow(true);

    const notices = vi.mocked(setup.notifications.notify).mock.calls
      .map(([request]) => request)
      .filter((request) => request.title.includes("update available"));
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toBe("SQLite JDBC Driver package update available");
    await notices[0].actions?.[0].run();
    expect(setup.shell.updateJdbcDriver).toHaveBeenCalledWith(sqlite);
  });

  it("confirms and stages restoration of a disabled artifact set", async () => {
    const disabled = status({
      disabledSets: [{
        id: "sqlite-disabled-1",
        version: "3.49.1.0",
        disabledAt: "2026-08-16T10:00:00.000Z",
        reason: "A newer version was selected.",
        pendingRestore: false,
        restorable: true,
        artifacts: [{ artifactId: sqlite.artifactId, fileName: "sqlite-jdbc-3.49.1.0.jar", source: "manual", version: "3.49.1.0" }]
      }]
    });
    const setup = options({
      updateChecksEnabled: () => false,
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [disabled]),
        restoreJdbcDriver: vi.fn(async () => ({ accepted: true, status: disabled }))
      }
    });
    await service.initialize(setup);

    const result = await service.restore("sqlite", "sqlite-disabled-1");

    expect(result.accepted).toBe(true);
    expect(setup.confirmOperation).toHaveBeenCalledWith("activate", sqlite, expect.objectContaining({
      displayName: "retained JDBC package 3.49.1.0"
    }));
    expect(setup.shell.restoreJdbcDriver).toHaveBeenCalledWith(sqlite, "sqlite-disabled-1");
    expect(setup.notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "JDBC driver activation staged"
    }));
  });

  it("confirms and removes a retained set without restarting the backend", async () => {
    const disabled = status({
      disabledSets: [{
        id: "sqlite-disabled-1",
        version: "3.49.1.0",
        disabledAt: "2026-08-16T10:00:00.000Z",
        reason: "A newer version was selected.",
        pendingRestore: false,
        restorable: true,
        artifacts: [{ artifactId: sqlite.artifactId, fileName: "sqlite-jdbc-3.49.1.0.jar", source: "manual", version: "3.49.1.0" }]
      }]
    });
    const active = status();
    const setup = options({
      updateChecksEnabled: () => false,
      shell: {
        ...options().shell,
        listJdbcDrivers: vi.fn(async () => [disabled]),
        discardJdbcDriverRetainedSet: vi.fn(async () => ({ accepted: true, status: active }))
      }
    });
    await service.initialize(setup);

    const result = await service.discardRetainedSet("sqlite", "sqlite-disabled-1");

    expect(result.accepted).toBe(true);
    expect(setup.confirmOperation).toHaveBeenCalledWith("discard", sqlite, expect.objectContaining({
      warning: expect.stringContaining("sqlite-jdbc-3.49.1.0.jar")
    }));
    expect(setup.shell.discardJdbcDriverRetainedSet).toHaveBeenCalledWith(sqlite, "sqlite-disabled-1");
    expect(setup.shell.restartBackendForJdbcDrivers).not.toHaveBeenCalled();
    expect(setup.notifications.notify).toHaveBeenCalledWith(expect.objectContaining({ title: "Retained JDBC version removed" }));
  });
});
