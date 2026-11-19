import { describe, expect, it, vi } from "vitest";
import type { BackendGatewayStatus, RuntimePluginStatus } from "@queryeer/api/backend";
import type { NotificationRequest } from "@queryeer/api/extensions/NotificationExtension";
import { describeProblems, watchBackendPluginProblems } from "./plugin-status-notifications";

function status(startedAt: string, pluginStatuses: RuntimePluginStatus[]): BackendGatewayStatus {
  return { runtimeStatus: { startedAt, pluginStatuses, activatedPluginIds: [] } } as unknown as BackendGatewayStatus;
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value)
  };
}

function setup(initial: BackendGatewayStatus | null, storage = memoryStorage()) {
  let listener: ((status: BackendGatewayStatus) => void) | undefined;
  const notifications: NotificationRequest[] = [];
  const stop = watchBackendPluginProblems({
    getStatus: () => (initial ? Promise.resolve(initial) : new Promise<BackendGatewayStatus>(() => undefined)),
    onStatusChanged: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    notify: (notification) => void notifications.push(notification),
    openObservability: vi.fn(),
    storage
  });
  return { notifications, emit: (next: BackendGatewayStatus) => listener?.(next), stop, storage };
}

const skipped: RuntimePluginStatus = {
  pluginId: "com.queryeer.jdbc.mysql",
  state: "skipped",
  reason: "Needs queryengine.jdbc ^0.20.0, but 0.21.0 is installed"
};

describe("watchBackendPluginProblems", () => {
  it("notifies once per backend run about skipped and failed plugins", async () => {
    const { notifications, emit } = setup(status("run-1", [skipped, { pluginId: "queryengine.jdbc", state: "activated" }]));
    await Promise.resolve();

    emit(status("run-1", [skipped]));

    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe("Plugin com.queryeer.jdbc.mysql was not loaded");
    expect(notifications[0].message).toBe("com.queryeer.jdbc.mysql: Needs queryengine.jdbc ^0.20.0, but 0.21.0 is installed");
    expect(notifications[0].severity).toBe("warning");

    emit(status("run-2", [skipped]));
    expect(notifications).toHaveLength(2);
  });

  it("stays quiet when every plugin loaded", () => {
    const { notifications, emit } = setup(null);
    emit(status("run-1", [{ pluginId: "queryengine.jdbc", state: "activated" }]));
    expect(notifications).toHaveLength(0);
  });

  it("does not repeat the notification after a window reload for the same backend run", () => {
    const storage = memoryStorage();
    setup(null, storage).emit(status("run-1", [skipped]));

    const reloaded = setup(null, storage);
    reloaded.emit(status("run-1", [skipped]));
    expect(reloaded.notifications).toHaveLength(0);
  });

  it("does not repeat during a restart, while events still carry the old run, and notifies for the new run", () => {
    const { notifications, emit } = setup(null);
    emit(status("run-1", [skipped]));
    emit(status("run-1", [skipped]));
    emit(status("run-2", [skipped]));
    expect(notifications).toHaveLength(2);
  });

  it("tolerates a failed status request and storage that throws", async () => {
    let listener: ((status: BackendGatewayStatus) => void) | undefined;
    const notify = vi.fn();
    watchBackendPluginProblems({
      getStatus: () => Promise.reject(new Error("no backend")),
      onStatusChanged: (next) => {
        listener = next;
        return () => undefined;
      },
      notify,
      openObservability: vi.fn(),
      storage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        }
      }
    });
    await Promise.resolve();

    listener?.(status("run-1", [skipped]));
    listener?.(status("run-1", [skipped]));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("waits for the runtime status", () => {
    const { notifications, emit } = setup(null);
    emit({} as BackendGatewayStatus);
    emit(status("run-1", [skipped]));
    expect(notifications).toHaveLength(1);
  });
});

describe("describeProblems", () => {
  it("lists several plugins, as an error when one failed", () => {
    const open = vi.fn();
    const notification = describeProblems(
      [skipped, { pluginId: "broken", state: "failed", reason: "Invalid plugin.json" }],
      open
    );

    expect(notification.title).toBe("2 plugins were not loaded");
    expect(notification.message).toBe(
      "com.queryeer.jdbc.mysql: Needs queryengine.jdbc ^0.20.0, but 0.21.0 is installed\nbroken: Invalid plugin.json"
    );
    expect(notification.severity).toBe("error");

    notification.actions?.[0].run();
    expect(open).toHaveBeenCalled();
  });
});
