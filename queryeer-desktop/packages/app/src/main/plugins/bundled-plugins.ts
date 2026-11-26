import { join } from "node:path";
import { compareVersions, parseVersion } from "./semver.js";

/** Bundled plugins ship next to the built-in ones: `<resources>/plugins/bundled/`, with this lock and the ZIPs it names. */
export const BUNDLED_PLUGINS_LOCK_FILE = "bundled-plugins.lock.json";

/**
 * One plugin the release bundled. Written by the release (the newest compatible version in the plugin catalog,
 * downloaded and checked there); the app checks the ZIP against `sha256` again before installing it.
 */
export type BundledPluginEntry = {
  id: string;
  version: string;
  /** The ZIP's file name, in the folder of the lock. */
  file: string;
  sha256: string;
  /** Where the release downloaded it from; informational. */
  url?: string;
};

export type BundledPluginsLock = {
  schemaVersion: 1;
  plugins: BundledPluginEntry[];
};

/** What happened to one bundled plugin at startup. */
export type BundledPluginOutcome = {
  id: string;
  version: string;
  /** The version installed before, when there was one. */
  previousVersion?: string;
  /** `pending`: its files were in use, so it is installed on the next start (tried again then). */
  result: "installed" | "upgraded" | "unchanged" | "uninstalled-by-user" | "pending" | "failed";
  /** Why it was left unchanged or failed. */
  reason?: string;
};

/** The default folder for a packaged app; `QUERYEER_BUNDLED_PLUGINS_DIR` overrides it, e.g. to try a bundle in a development run. */
export function resolveBundledPluginsDir(resourcesPath: string | undefined, isPackaged: boolean, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.QUERYEER_BUNDLED_PLUGINS_DIR?.trim();
  if (override) {
    return override;
  }
  return isPackaged && resourcesPath ? join(resourcesPath, "plugins", "bundled") : undefined;
}

/** Parses the lock; throws with the reason when it isn't one. */
export function parseBundledPluginsLock(text: string): BundledPluginsLock {
  const parsed = JSON.parse(text) as { schemaVersion?: unknown; plugins?: unknown };
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.plugins)) {
    throw new Error(`${BUNDLED_PLUGINS_LOCK_FILE} must have schemaVersion 1 and a plugins array`);
  }
  const plugins = parsed.plugins.map((entry, index) => {
    const candidate = entry as Partial<BundledPluginEntry>;
    for (const field of ["id", "version", "file", "sha256"] as const) {
      if (typeof candidate[field] !== "string" || candidate[field].length === 0) {
        throw new Error(`${BUNDLED_PLUGINS_LOCK_FILE}: plugin ${index} has no ${field}`);
      }
    }
    if (candidate.file!.includes("/") || candidate.file!.includes("\\") || candidate.file === "..") {
      throw new Error(`${BUNDLED_PLUGINS_LOCK_FILE}: plugin ${candidate.id} names a file outside its folder: ${candidate.file}`);
    }
    return candidate as BundledPluginEntry;
  });
  // Ids differing only in case share an install folder on Windows
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (seen.has(plugin.id.toLowerCase())) {
      throw new Error(`${BUNDLED_PLUGINS_LOCK_FILE}: plugin ${plugin.id} is listed twice`);
    }
    seen.add(plugin.id.toLowerCase());
  }
  return { schemaVersion: 1, plugins };
}

/**
 * Whether to install a bundled plugin, given what is installed. A missing or older plugin is installed; a newer one,
 * one the user uninstalled, or one whose version can't be compared is left as it is.
 */
export function planBundledPlugin(
  entry: BundledPluginEntry,
  installed: { version: string; uninstallPending: boolean } | undefined,
  uninstalledByUser: boolean
): BundledPluginOutcome | "install" | "upgrade" {
  const base = { id: entry.id, version: entry.version };
  if (uninstalledByUser) {
    return { ...base, result: "uninstalled-by-user" };
  }
  if (!installed) {
    return "install";
  }
  if (installed.uninstallPending) {
    return { ...base, previousVersion: installed.version, result: "uninstalled-by-user" };
  }
  let comparison: number;
  try {
    comparison = compareVersions(parseVersion(installed.version), parseVersion(entry.version));
  } catch (error) {
    return { ...base, previousVersion: installed.version, result: "unchanged", reason: `Cannot compare versions: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (comparison >= 0) {
    return {
      ...base,
      previousVersion: installed.version,
      result: "unchanged",
      ...(comparison > 0 ? { reason: `${installed.version} is newer than the bundled ${entry.version}` } : {})
    };
  }
  return "upgrade";
}
