import type { BackendGatewayStatus, RuntimePluginStatus } from "@queryeer/api/backend";
import type { NotificationRequest } from "@queryeer/api/extensions/NotificationExtension";

/** Survives Reload Window, so a reload doesn't repeat the notification for the same backend run. */
const NOTIFIED_RUN_KEY = "core.observability.notifiedBackendRun";

export type PluginStatusNotificationDeps = {
  getStatus: () => Promise<BackendGatewayStatus>;
  onStatusChanged: (listener: (status: BackendGatewayStatus) => void) => () => void;
  notify: (notification: NotificationRequest) => void;
  openObservability: () => void;
  storage?: Pick<Storage, "getItem" | "setItem">;
};

/**
 * Notifies once per backend run about backend plugins that were skipped or failed. Their frontend may still have
 * loaded, so without this the first sign is an error when the plugin is used.
 */
export function watchBackendPluginProblems(deps: PluginStatusNotificationDeps): () => void {
  let notifiedRun = readNotifiedRun(deps.storage);

  const check = (status: BackendGatewayStatus | null | undefined) => {
    const runtimeStatus = status?.runtimeStatus;
    if (!runtimeStatus || runtimeStatus.startedAt === notifiedRun) {
      return;
    }
    const problems = runtimeStatus.pluginStatuses.filter((plugin) => plugin.state === "skipped" || plugin.state === "failed");
    if (problems.length > 0) {
      deps.notify(describeProblems(problems, deps.openObservability));
    }
    notifiedRun = runtimeStatus.startedAt;
    writeNotifiedRun(deps.storage, notifiedRun);
  };

  const unsubscribe = deps.onStatusChanged(check);
  void deps.getStatus().then(check, () => undefined);
  return unsubscribe;
}

export function describeProblems(problems: RuntimePluginStatus[], openObservability: () => void): NotificationRequest {
  const title = problems.length === 1 ? `Plugin ${problems[0].pluginId} was not loaded` : `${problems.length} plugins were not loaded`;
  return {
    title,
    message: problems.map((plugin) => `${plugin.pluginId}: ${plugin.reason ?? plugin.state}`).join("\n"),
    severity: problems.some((plugin) => plugin.state === "failed") ? "error" : "warning",
    actions: [{ id: "core.observability.open", label: "Open Observability", run: openObservability }]
  };
}

function readNotifiedRun(storage: PluginStatusNotificationDeps["storage"]): string | null {
  try {
    return storage?.getItem(NOTIFIED_RUN_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeNotifiedRun(storage: PluginStatusNotificationDeps["storage"], run: string): void {
  try {
    storage?.setItem(NOTIFIED_RUN_KEY, run);
  } catch {
    // Without storage, a reload notifies again
  }
}
