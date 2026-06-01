import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import JSZip from "jszip";
import type {
  ManagedPluginInventory,
  ManagedPluginInventoryEntry,
  ManagedPluginSetEnabledResult,
  ManagedPluginSourceType
} from "@queryeer/api/plugin/PluginInventory.js";

type PluginManifestV1 = {
  schemaVersion?: number;
  id?: string;
  name?: string;
  version?: string;
  frontend?: { entryModule?: string };
  backend?: { entrypointClass?: string; factoryClass?: string };
};

type PluginLockDocument = {
  version: 1;
  plugins: PluginLockEntry[];
};

type PluginLockEntry = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  source: {
    type: ManagedPluginSourceType;
    path: string;
  };
  restartRequired?: boolean;
};

type DiscoveredManagedPlugin = {
  id: string;
  name: string;
  version: string;
  sourcePath: string;
  sourceType: ManagedPluginSourceType;
  hasFrontend: boolean;
  hasBackend: boolean;
  lastError?: string;
};

const LOCKFILE_VERSION = 1;
const MANIFEST_FILE = "plugin.json";
const ZIP_EXTENSION = ".zip";

export class PluginInventoryService {
  private inventory: ManagedPluginInventory;
  private lockDocument: PluginLockDocument = { version: LOCKFILE_VERSION, plugins: [] };

  public constructor(
    private readonly options: {
      pluginsDir: string;
      lockfilePath: string;
      isSafeMode: () => boolean;
    }
  ) {
    this.inventory = {
      pluginsDir: options.pluginsDir,
      lockfilePath: options.lockfilePath,
      safeMode: options.isSafeMode(),
      plugins: []
    };
  }

  public async initialize(): Promise<void> {
    await this.refresh({ clearRestartRequired: true });
  }

  public async getInventory(): Promise<ManagedPluginInventory> {
    await this.refresh();
    return this.inventory;
  }

  public getDisabledPluginIds(): string[] {
    return this.lockDocument.plugins
      .filter((plugin) => !plugin.enabled)
      .map((plugin) => plugin.id)
      .sort((left, right) => left.localeCompare(right));
  }

  public async setEnabled(pluginId: string, enabled: boolean): Promise<ManagedPluginSetEnabledResult> {
    await this.refresh();
    const lockEntry = this.lockDocument.plugins.find((plugin) => plugin.id === pluginId);
    if (!lockEntry) {
      return {
        accepted: false,
        restartRequired: false,
        reason: `Plugin '${pluginId}' is not installed`
      };
    }

    lockEntry.enabled = enabled;
    lockEntry.restartRequired = true;
    this.writeLockDocument();
    await this.refresh();

    return {
      accepted: true,
      restartRequired: true,
      plugin: this.inventory.plugins.find((plugin) => plugin.id === pluginId)
    };
  }

  private async refresh(options: { clearRestartRequired?: boolean } = {}): Promise<void> {
    mkdirSync(this.options.pluginsDir, { recursive: true });
    this.lockDocument = this.readLockDocument();
    if (options.clearRestartRequired) {
      for (const plugin of this.lockDocument.plugins) {
        plugin.restartRequired = false;
      }
    }

    const discovered = await this.discoverManagedPlugins();
    const discoveredById = new Map<string, DiscoveredManagedPlugin>();
    const duplicates = new Set<string>();
    for (const plugin of discovered) {
      if (discoveredById.has(plugin.id)) {
        duplicates.add(plugin.id);
        continue;
      }
      discoveredById.set(plugin.id, plugin);
    }

    const lockById = new Map(this.lockDocument.plugins.map((plugin) => [plugin.id, plugin]));
    for (const plugin of discoveredById.values()) {
      const existing = lockById.get(plugin.id);
      if (existing) {
        existing.name = plugin.name;
        existing.version = plugin.version;
        existing.source = { type: plugin.sourceType, path: plugin.sourcePath };
        continue;
      }

      const next: PluginLockEntry = {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        enabled: true,
        source: { type: plugin.sourceType, path: plugin.sourcePath },
        restartRequired: false
      };
      this.lockDocument.plugins.push(next);
      lockById.set(plugin.id, next);
    }

    this.lockDocument.plugins.sort((left, right) => left.id.localeCompare(right.id));
    this.writeLockDocument();

    const plugins: ManagedPluginInventoryEntry[] = [];
    for (const lockEntry of this.lockDocument.plugins) {
      const discoveredPlugin = discoveredById.get(lockEntry.id);
      if (!discoveredPlugin) {
        plugins.push({
          id: lockEntry.id,
          name: lockEntry.name,
          version: lockEntry.version,
          enabled: lockEntry.enabled,
          sourcePath: lockEntry.source.path,
          sourceType: lockEntry.source.type,
          status: "missing",
          hasFrontend: false,
          hasBackend: false,
          lastError: "Plugin source is no longer present",
          restartRequired: lockEntry.restartRequired === true
        });
        continue;
      }

      plugins.push({
        id: discoveredPlugin.id,
        name: discoveredPlugin.name,
        version: discoveredPlugin.version,
        enabled: lockEntry.enabled,
        sourcePath: discoveredPlugin.sourcePath,
        sourceType: discoveredPlugin.sourceType,
        status: duplicates.has(discoveredPlugin.id) ? "invalid" : "available",
        hasFrontend: discoveredPlugin.hasFrontend,
        hasBackend: discoveredPlugin.hasBackend,
        lastError: duplicates.has(discoveredPlugin.id) ? "Duplicate plugin id discovered in managed plugins directory" : discoveredPlugin.lastError,
        restartRequired: lockEntry.restartRequired === true
      });
    }

    this.inventory = {
      pluginsDir: this.options.pluginsDir,
      lockfilePath: this.options.lockfilePath,
      safeMode: this.options.isSafeMode(),
      plugins
    };
  }

  private readLockDocument(): PluginLockDocument {
    if (!existsSync(this.options.lockfilePath)) {
      return { version: LOCKFILE_VERSION, plugins: [] };
    }

    try {
      const parsed = JSON.parse(readFileSync(this.options.lockfilePath, "utf8")) as Partial<PluginLockDocument>;
      if (parsed.version !== LOCKFILE_VERSION || !Array.isArray(parsed.plugins)) {
        return { version: LOCKFILE_VERSION, plugins: [] };
      }
      return {
        version: LOCKFILE_VERSION,
        plugins: parsed.plugins.filter(isLockEntry)
      };
    } catch {
      return { version: LOCKFILE_VERSION, plugins: [] };
    }
  }

  private writeLockDocument(): void {
    mkdirSync(dirname(this.options.lockfilePath), { recursive: true });
    writeFileSync(this.options.lockfilePath, `${JSON.stringify(this.lockDocument, null, 2)}\n`, "utf8");
  }

  private async discoverManagedPlugins(): Promise<DiscoveredManagedPlugin[]> {
    if (!existsSync(this.options.pluginsDir)) {
      return [];
    }

    const entries = readdirSync(this.options.pluginsDir)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => join(this.options.pluginsDir, name));
    const plugins: DiscoveredManagedPlugin[] = [];

    for (const entry of entries) {
      try {
        const stats = statSync(entry);
        if (stats.isDirectory()) {
          const plugin = this.loadFolderPlugin(entry);
          if (plugin) {
            plugins.push(plugin);
          }
        } else if (stats.isFile() && entry.toLowerCase().endsWith(ZIP_EXTENSION)) {
          const plugin = await this.loadZipPlugin(entry);
          if (plugin) {
            plugins.push(plugin);
          }
        }
      } catch {
        // ignore unreadable plugin entries; install validation will surface detailed errors later
      }
    }

    return plugins;
  }

  private loadFolderPlugin(folderPath: string): DiscoveredManagedPlugin | null {
    const manifestPath = join(folderPath, MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as PluginManifestV1;
    return toDiscoveredPlugin(parsed, folderPath, "folder");
  }

  private async loadZipPlugin(zipPath: string): Promise<DiscoveredManagedPlugin | null> {
    const archive = await JSZip.loadAsync(readFileSync(zipPath));
    const manifest = archive.file(MANIFEST_FILE);
    if (!manifest) {
      return null;
    }
    const parsed = JSON.parse(await manifest.async("string")) as PluginManifestV1;
    return toDiscoveredPlugin(parsed, zipPath, "zip");
  }
}

function toDiscoveredPlugin(parsed: PluginManifestV1, sourcePath: string, sourceType: ManagedPluginSourceType): DiscoveredManagedPlugin | null {
  if (!isValidManifest(parsed)) {
    return null;
  }
  return {
    id: parsed.id,
    name: parsed.name,
    version: parsed.version,
    sourcePath,
    sourceType,
    hasFrontend: parsed.frontend != null,
    hasBackend: parsed.backend != null
  };
}

function isValidManifest(parsed: PluginManifestV1): parsed is Required<Pick<PluginManifestV1, "schemaVersion" | "id" | "name" | "version">> & PluginManifestV1 {
  return (
    parsed.schemaVersion === 1 &&
    typeof parsed.id === "string" &&
    parsed.id.length > 0 &&
    typeof parsed.name === "string" &&
    parsed.name.length > 0 &&
    typeof parsed.version === "string" &&
    parsed.version.length > 0 &&
    (parsed.frontend != null || parsed.backend != null)
  );
}

function isLockEntry(value: unknown): value is PluginLockEntry {
  const candidate = value as Partial<PluginLockEntry>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string" &&
    typeof candidate.enabled === "boolean" &&
    candidate.source != null &&
    (candidate.source.type === "folder" || candidate.source.type === "zip") &&
    typeof candidate.source.path === "string"
  );
}

export function defaultPluginsLockfilePath(settingsDirPath: string): string {
  return join(settingsDirPath, "plugins-lock.json");
}

export function managedPluginDisplayPath(entry: ManagedPluginInventoryEntry): string {
  return entry.sourceType === "zip" ? basename(entry.sourcePath) : entry.sourcePath;
}
