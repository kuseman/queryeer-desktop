import type { BackendGatewayStatus, RuntimePluginStatus } from "@queryeer/api/backend";
import type { NotificationRequest } from "@queryeer/api/extensions/NotificationExtension";
import type { ObservedPluginLoad, PluginUpgradeReport } from "@queryeer/api/plugin/PluginInventory";
import type { PluginDiagnostics } from "../../core/plugin-runtime/PluginDiagnostics";

/** Whether each plugin's frontend and backend loaded on this start, from the plugin host and the backend's status. */
export function observePluginLoads(diagnostics: PluginDiagnostics, backendStatuses: RuntimePluginStatus[]): ObservedPluginLoad[] {
  const loads = new Map<string, ObservedPluginLoad>();
  const loadFor = (pluginId: string): ObservedPluginLoad => {
    let load = loads.get(pluginId);
    if (!load) {
      load = { pluginId };
      loads.set(pluginId, load);
    }
    return load;
  };

  const activated = new Set(diagnostics.activationOrder);
  for (const id of new Set([...diagnostics.discoveredManifestIds, ...diagnostics.activationOrder])) {
    loadFor(id).frontend = activated.has(id) ? { loaded: true } : { loaded: false, reason: "Its frontend wasn't activated" };
  }
  for (const problem of diagnostics.pluginProblems ?? []) {
    if (problem.state !== "warning") {
      loadFor(problem.pluginId).frontend = { loaded: false, reason: problem.message };
    }
  }
  for (const error of diagnostics.externalLoadErrors ?? []) {
    loadFor(error.pluginId).frontend = { loaded: false, reason: error.message };
  }
  for (const status of backendStatuses) {
    loadFor(status.pluginId).backend = status.state === "activated"
      ? { loaded: true }
      : { loaded: false, reason: status.reason ?? `Its backend is ${status.state}` };
  }
  return [...loads.values()];
}

export function describeUpgradeReport(report: PluginUpgradeReport, openObservability: () => void): NotificationRequest {
  const count = report.plugins.length;
  const upgrade = report.previousVersion ? `updating from Queryeer ${report.previousVersion} to ${report.appVersion}` : `updating to Queryeer ${report.appVersion}`;
  return {
    // "Need attention": a bundled plugin that couldn't be upgraded may still run its old version
    title: count === 1 ? `After ${upgrade}, a plugin needs attention` : `After ${upgrade}, ${count} plugins need attention`,
    message: report.plugins.map((plugin) => `${plugin.name && plugin.name !== plugin.pluginId ? `${plugin.name} (${plugin.pluginId})` : plugin.pluginId}: ${plugin.reason}`).join("\n"),
    severity: "warning",
    actions: [{ id: "core.observability.open", label: "Open Observability", run: openObservability }]
  };
}

export type PluginUpgradeWatchDeps = {
  getStatus: () => Promise<BackendGatewayStatus>;
  onStatusChanged: (listener: (status: BackendGatewayStatus) => void) => () => void;
  getDiagnostics: () => PluginDiagnostics;
  recordPluginLoads: (observed: ObservedPluginLoad[]) => Promise<PluginUpgradeReport | null>;
  /** Called with a report before it is shown, e.g. to close this start's toasts about the same plugins. */
  onReport?: (report: PluginUpgradeReport) => void;
  notify: (notification: NotificationRequest) => void;
  openObservability: () => void;
};

/**
 * Once the backend has reported which plugins it loaded, records this start's plugin loads and, on the first start of a
 * new Queryeer version, notifies about the plugins it broke. Once per window: the main process reports a version once.
 */
export function watchPluginUpgrade(deps: PluginUpgradeWatchDeps): () => void {
  let done = false;
  let unsubscribe: () => void = () => undefined;
  const check = (status: BackendGatewayStatus | null | undefined) => {
    const runtimeStatus = status?.runtimeStatus;
    if (done || !runtimeStatus) {
      return;
    }
    done = true;
    unsubscribe();
    deps.recordPluginLoads(observePluginLoads(deps.getDiagnostics(), runtimeStatus.pluginStatuses)).then(
      (report) => {
        if (report) {
          deps.onReport?.(report);
          deps.notify(describeUpgradeReport(report, deps.openObservability));
        }
      },
      (error: unknown) => console.warn("[plugins] Could not record which plugins loaded", error)
    );
  };
  unsubscribe = deps.onStatusChanged(check);
  if (done) {
    unsubscribe();
  }
  void deps.getStatus().then(check, () => undefined);
  return () => {
    done = true;
    unsubscribe();
  };
}
