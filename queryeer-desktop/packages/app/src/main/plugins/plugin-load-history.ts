import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ManagedPluginInventoryEntry, ObservedPluginLoad, PluginUpgradeReport } from "@queryeer/api/plugin/PluginInventory.js";
import type { BundledPluginOutcome } from "./bundled-plugins.js";

/** Which installed plugins loaded on the last start, and with which Queryeer version. */
type PluginLoadHistory = {
  appVersion: string;
  loaded: string[];
};

export function defaultPluginLoadHistoryPath(settingsDirPath: string): string {
  return join(settingsDirPath, "plugin-load-history.json");
}

/**
 * Whether each installed plugin that should run loaded: an enabled plugin, not replaced by a developer folder, with
 * every half it has loaded. A half that wasn't observed didn't load.
 */
export function installedPluginLoads(
  plugins: ManagedPluginInventoryEntry[],
  observed: ObservedPluginLoad[],
  developmentIds: ReadonlySet<string>
): { pluginId: string; name: string; loaded: boolean; reason?: string }[] {
  const byId = new Map(observed.map((entry) => [entry.pluginId, entry]));
  return plugins
    // A plugin enabled or installed since this start (restartRequired) isn't meant to have loaded yet
    .filter((plugin) => plugin.enabled && plugin.uninstallPending !== true && plugin.restartRequired !== true && plugin.status !== "missing" && !developmentIds.has(plugin.id))
    .map((plugin) => {
      const seen = byId.get(plugin.id);
      const reasons: string[] = [];
      if (plugin.hasFrontend && seen?.frontend?.loaded !== true) {
        reasons.push(seen?.frontend?.reason ?? "Its frontend didn't load");
      }
      if (plugin.hasBackend && seen?.backend?.loaded !== true) {
        reasons.push(seen?.backend?.reason ?? "Its backend didn't load");
      }
      return { pluginId: plugin.id, name: plugin.name, loaded: reasons.length === 0, ...(reasons.length > 0 ? { reason: reasons.join("; ") } : {}) };
    });
}

/**
 * Records which installed plugins loaded on this start, and reports what a new Queryeer version broke: on its first
 * start, the plugins that don't load but did on the version before, or that it bundled, and the bundled plugins it
 * couldn't install. A plugin that didn't load before either is left out. Before 0.24 nothing was recorded, so then every
 * plugin that doesn't load is reported. Null when nothing is reported, and on any later start of the same version.
 */
export function recordPluginLoads(options: {
  historyPath: string;
  appVersion: string;
  loads: { pluginId: string; name: string; loaded: boolean; reason?: string }[];
  bundled: BundledPluginOutcome[];
}): PluginUpgradeReport | null {
  const previous = readHistory(options.historyPath);
  const report = previous?.appVersion === options.appVersion ? null : upgradeReport(options, previous);
  try {
    writeHistory(options.historyPath, { appVersion: options.appVersion, loaded: options.loads.filter((load) => load.loaded).map((load) => load.pluginId) });
  } catch (error) {
    // The next start tries again, and reports again
    console.warn("[plugins] Could not record which plugins loaded", error);
  }
  return report;
}

function upgradeReport(
  options: { appVersion: string; loads: { pluginId: string; name: string; loaded: boolean; reason?: string }[]; bundled: BundledPluginOutcome[] },
  previous: PluginLoadHistory | null
): PluginUpgradeReport | null {
  const bundledNow = new Set(options.bundled.filter((outcome) => outcome.result === "installed" || outcome.result === "upgraded").map((outcome) => outcome.id));
  const plugins: PluginUpgradeReport["plugins"] = options.loads
    .filter((load) => !load.loaded && (!previous || previous.loaded.includes(load.pluginId) || bundledNow.has(load.pluginId)))
    .map((load) => ({ pluginId: load.pluginId, name: load.name, reason: load.reason ?? "It didn't load" }));
  for (const outcome of options.bundled) {
    const reason = outcome.result === "failed" && outcome.version === ""
      // The bundle's lock itself couldn't be read
      ? `The bundled plugins weren't installed: ${outcome.reason ?? "unknown reason"}`
      : outcome.result === "failed"
      ? `Its bundled version ${outcome.version} wasn't installed: ${outcome.reason ?? "unknown reason"}`
      : outcome.result === "pending"
        ? `Its bundled version ${outcome.version} is installed on the next start: its files were in use`
        : undefined;
    if (reason === undefined) {
      continue;
    }
    const listed = plugins.find((plugin) => plugin.pluginId === outcome.id);
    if (listed) {
      listed.reason = `${listed.reason}. ${reason}`;
    } else {
      plugins.push({ pluginId: outcome.id, reason });
    }
  }
  if (plugins.length === 0) {
    return null;
  }
  return { appVersion: options.appVersion, ...(previous ? { previousVersion: previous.appVersion } : {}), plugins };
}

function readHistory(path: string): PluginLoadHistory | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<PluginLoadHistory>;
    return typeof parsed.appVersion === "string" && Array.isArray(parsed.loaded)
      ? { appVersion: parsed.appVersion, loaded: parsed.loaded.filter((id): id is string => typeof id === "string") }
      : null;
  } catch {
    return null;
  }
}

function writeHistory(path: string, history: PluginLoadHistory): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}
