import { createElement } from "react";
import type { LayoutRegistry } from "@queryeer/api/extensions/LayoutExtension.js";
import type { NotificationService } from "@queryeer/api/extensions/NotificationExtension.js";
import type { JdbcDriverBackendRestartResult } from "@queryeer/api/queryengine/JdbcDriverExtension.js";

export const RESTART_BACKEND_COMMAND_ID = "core.backend.restartAndReload";

type Shell = {
  restartBackend: () => Promise<JdbcDriverBackendRestartResult>;
  reloadWindow: () => Promise<void>;
};

/**
 * `core.backend.restartAndReload` (API-GAPS D2): restarts the backend, so backend plugins are discovered and loaded again, then
 * reloads the window, so external plugins' frontends are imported again and match their backends. A refused restart
 * (queries running, a restart already in progress) leaves both as they are and says why.
 */
export async function restartBackendAndReload(shell: Shell, notifications: Pick<NotificationService, "notify">): Promise<boolean> {
  const result = await shell.restartBackend();
  if (!result.accepted) {
    notifications.notify({
      title: "Backend not restarted",
      message: result.reason ?? "The backend could not be restarted",
      severity: "warning"
    });
    return false;
  }
  await shell.reloadWindow();
  return true;
}

/**
 * With developer plugin folders set (`QUERYEER_DEV_PLUGINS`), Restart Backend and Reload is part of every edit-build-try round,
 * so it also sits in the status bar. Without them it stays in Tools → Dev and the command palette only.
 */
export function registerRestartBackendStatusItem(layout: Pick<LayoutRegistry, "registerStatusItem">, hasDevelopmentPlugins: boolean): void {
  if (!hasDevelopmentPlugins) {
    return;
  }
  layout.registerStatusItem({
    id: "core.menu.status.restartBackendAndReload",
    alignment: "left",
    order: 90,
    commandId: RESTART_BACKEND_COMMAND_ID,
    render: () =>
      createElement(
        "span",
        { title: "Developer plugin folders are loaded (QUERYEER_DEV_PLUGINS). Restarts the backend and reloads the window." },
        "↻ Restart Backend and Reload"
      )
  });
}
