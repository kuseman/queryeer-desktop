import { describe, expect, it, vi } from "vitest";
import { RESTART_BACKEND_COMMAND_ID, registerRestartBackendStatusItem, restartBackendAndReload } from "./restart-backend";

describe("restartBackendAndReload", () => {
  it("reloads the window after the backend restarted", async () => {
    const shell = { restartBackend: vi.fn(async () => ({ accepted: true })), reloadWindow: vi.fn(async () => {}) };
    const notifications = { notify: vi.fn() };

    expect(await restartBackendAndReload(shell, notifications)).toBe(true);
    expect(shell.reloadWindow).toHaveBeenCalledOnce();
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it("keeps the window and says why when the restart is refused", async () => {
    const shell = {
      restartBackend: vi.fn(async () => ({ accepted: false, reason: "Backend restart deferred while 1 query execution(s) are active" })),
      reloadWindow: vi.fn(async () => {})
    };
    const notifications = { notify: vi.fn() };

    expect(await restartBackendAndReload(shell, notifications)).toBe(false);
    expect(shell.reloadWindow).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
      title: "Backend not restarted",
      message: "Backend restart deferred while 1 query execution(s) are active",
      severity: "warning"
    }));
  });
});

describe("registerRestartBackendStatusItem", () => {
  it("adds Restart Backend and Reload to the status bar only with developer plugin folders", () => {
    const layout = { registerStatusItem: vi.fn() };

    registerRestartBackendStatusItem(layout, false);
    expect(layout.registerStatusItem).not.toHaveBeenCalled();

    registerRestartBackendStatusItem(layout, true);
    expect(layout.registerStatusItem).toHaveBeenCalledWith(expect.objectContaining({ commandId: RESTART_BACKEND_COMMAND_ID }));
  });
});
