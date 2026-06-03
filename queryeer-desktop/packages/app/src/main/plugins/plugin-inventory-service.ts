import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, normalize, sep } from "node:path";
import JSZip from "jszip";
import type {
  ManagedPluginInstallResult,
  ManagedPluginInventory,
  ManagedPluginInventoryEntry,
  ManagedPluginSetEnabledResult,
  ManagedPluginSourceType,
  ManagedPluginUninstallResult
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
  installSourcePath?: string;
  integrity?: {
    algorithm: "sha256";
    archiveHash: string;
    installedAt: string;
  };
  uninstallPending?: boolean;
  restartRequired?: boolean;
  installPending?: {
    stagingDir: string;
  };
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
const STAGING_DIR = ".staging";

export class PluginInventoryService {
  private inventory: ManagedPluginInventory;
  private lockDocument: PluginLockDocument = { version: LOCKFILE_VERSION, plugins: [] };
  private readonly now: () => Date;

  public constructor(
    private readonly options: {
      pluginsDir: string;
      lockfilePath: string;
      isSafeMode: () => boolean;
      now?: () => Date;
    }
  ) {
    this.now = options.now ?? (() => new Date());
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
    if (lockEntry.uninstallPending === true) {
      return {
        accepted: false,
        restartRequired: true,
        reason: `Plugin '${pluginId}' is pending uninstall and cannot be toggled`
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

  public async installFromZip(zipFilePath: string): Promise<ManagedPluginInstallResult> {
    if (!zipFilePath || extname(zipFilePath).toLowerCase() !== ZIP_EXTENSION) {
      return {
        accepted: false,
        restartRequired: false,
        reason: "A .zip plugin package is required"
      };
    }

    let archive: JSZip;
    try {
      archive = await JSZip.loadAsync(readFileSync(zipFilePath));
    } catch {
      return {
        accepted: false,
        restartRequired: false,
        reason: `Failed to read plugin archive '${zipFilePath}'`
      };
    }

    const manifestFile = archive.file(MANIFEST_FILE);
    if (!manifestFile) {
      return {
        accepted: false,
        restartRequired: false,
        reason: "Plugin archive is missing plugin.json at the archive root"
      };
    }

    let parsedManifest: PluginManifestV1;
    try {
      parsedManifest = JSON.parse(await manifestFile.async("string")) as PluginManifestV1;
    } catch {
      return {
        accepted: false,
        restartRequired: false,
        reason: "plugin.json in archive is not valid JSON"
      };
    }
    if (!isValidManifest(parsedManifest)) {
      return {
        accepted: false,
        restartRequired: false,
        reason: "plugin.json is missing required fields for schemaVersion 1"
      };
    }

    const pluginId = parsedManifest.id;
    const archiveHash = sha256(readFileSync(zipFilePath));
    await this.refresh();
    const existingLockEntry = this.lockDocument.plugins.find((plugin) => plugin.id === pluginId);
    const installDir = pluginInstallDir(this.options.pluginsDir, pluginId);
    const stagingRoot = join(this.options.pluginsDir, STAGING_DIR);
    const stagingDir = join(stagingRoot, `${pluginId}-${Date.now()}`);
    const backupDir = join(stagingRoot, `${pluginId}-backup-${Date.now()}`);

    try {
      mkdirSync(stagingDir, { recursive: true });
      await extractArchiveToDirectory(archive, stagingDir);
      const stagedManifestPath = join(stagingDir, MANIFEST_FILE);
      if (!existsSync(stagedManifestPath)) {
        throw new Error("Extracted archive is missing plugin.json");
      }

      const stagedManifest = JSON.parse(readFileSync(stagedManifestPath, "utf8")) as PluginManifestV1;
      if (!isValidManifest(stagedManifest)) {
        throw new Error("Extracted plugin.json is invalid");
      }
      if (stagedManifest.id !== pluginId) {
        throw new Error("Plugin id changed between archive read and extraction");
      }

      if (existsSync(installDir)) {
        mkdirSync(stagingRoot, { recursive: true });
        try {
          renameSync(installDir, backupDir);
        } catch {
          // Plugin directory is locked (JVM has files open, typically on Windows).
          // Defer the swap to restart following the same pattern as uninstallPending.
          return await this.schedulePendingInstall(
            pluginId, parsedManifest, stagingDir, zipFilePath, archiveHash
          );
        }
      } else if (existingLockEntry?.source.path && !isSamePath(existingLockEntry.source.path, installDir) && existsSync(existingLockEntry.source.path)) {
        rmSync(existingLockEntry.source.path, { recursive: true, force: true });
      }

      renameSync(stagingDir, installDir);
      if (existsSync(backupDir)) {
        rmSync(backupDir, { recursive: true, force: true });
      }
    } catch (error) {
      if (existsSync(backupDir) && !existsSync(installDir)) {
        try {
          renameSync(backupDir, installDir);
        } catch {
          // best effort rollback
        }
      }
      rmSync(stagingDir, { recursive: true, force: true });
      return {
        accepted: false,
        restartRequired: false,
        reason: error instanceof Error ? error.message : "Failed to install plugin package"
      };
    }

    await this.refresh();
    const lockEntry = this.lockDocument.plugins.find((plugin) => plugin.id === pluginId);
    if (lockEntry) {
      lockEntry.installSourcePath = zipFilePath;
      lockEntry.integrity = {
        algorithm: "sha256",
        archiveHash,
        installedAt: this.now().toISOString()
      };
      lockEntry.restartRequired = true;
      this.writeLockDocument();
      await this.refresh();
    }

    return {
      accepted: true,
      restartRequired: true,
      plugin: this.inventory.plugins.find((plugin) => plugin.id === pluginId)
    };
  }

  private async schedulePendingInstall(
    pluginId: string,
    manifest: PluginManifestV1,
    stagingDir: string,
    zipFilePath: string,
    archiveHash: string
  ): Promise<ManagedPluginInstallResult> {
    await this.refresh();
    const lockEntry = this.lockDocument.plugins.find((p) => p.id === pluginId);
    const installDir = pluginInstallDir(this.options.pluginsDir, pluginId);

    // Clean up any previous pending staging directory for this plugin
    if (lockEntry?.installPending?.stagingDir && existsSync(lockEntry.installPending.stagingDir)) {
      try {
        rmSync(lockEntry.installPending.stagingDir, { recursive: true, force: true });
      } catch {
        // best effort cleanup
      }
    }

    const { name: pluginName, version: pluginVersion } = manifest as Required<Pick<PluginManifestV1, "name" | "version">>;

    if (lockEntry) {
      lockEntry.version = pluginVersion;
      lockEntry.installSourcePath = zipFilePath;
      lockEntry.integrity = {
        algorithm: "sha256",
        archiveHash,
        installedAt: this.now().toISOString()
      };
      lockEntry.restartRequired = true;
      lockEntry.installPending = { stagingDir };
    } else {
      this.lockDocument.plugins.push({
        id: pluginId,
        name: pluginName,
        version: pluginVersion,
        enabled: true,
        source: { type: "folder", path: installDir },
        installSourcePath: zipFilePath,
        integrity: {
          algorithm: "sha256",
          archiveHash,
          installedAt: this.now().toISOString()
        },
        restartRequired: true,
        installPending: { stagingDir }
      });
    }

    this.writeLockDocument();
    await this.refresh();

    return {
      accepted: true,
      restartRequired: true,
      plugin: this.inventory.plugins.find((p) => p.id === pluginId)
    };
  }

  public async uninstall(pluginId: string): Promise<ManagedPluginUninstallResult> {
    await this.refresh();
    const lockEntry = this.lockDocument.plugins.find((plugin) => plugin.id === pluginId);
    if (!lockEntry) {
      return {
        accepted: false,
        restartRequired: false,
        reason: `Plugin '${pluginId}' is not installed`
      };
    }

    lockEntry.enabled = false;
    lockEntry.uninstallPending = true;
    lockEntry.restartRequired = true;
    this.writeLockDocument();
    await this.refresh();

    const stillPresent = this.lockDocument.plugins.some((plugin) => plugin.id === pluginId);

    return {
      accepted: true,
      restartRequired: true,
      removedPluginId: pluginId,
      reason: stillPresent ? "Uninstall scheduled for restart because plugin files are in use" : undefined
    };
  }

  private processPendingInstalls(): void {
    const stagingRoot = join(this.options.pluginsDir, STAGING_DIR);
    for (const lockEntry of this.lockDocument.plugins) {
      const pending = lockEntry.installPending;
      if (!pending || typeof pending.stagingDir !== "string") {
        continue;
      }

      if (!existsSync(pending.stagingDir)) {
        // Staging directory is gone — nothing to apply
        delete lockEntry.installPending;
        continue;
      }

      const installDir = pluginInstallDir(this.options.pluginsDir, lockEntry.id);
      const backupDir = join(stagingRoot, `${lockEntry.id}-backup-${Date.now()}`);

      try {
        if (existsSync(installDir)) {
          renameSync(installDir, backupDir);
        }
        renameSync(pending.stagingDir, installDir);
        if (existsSync(backupDir)) {
          rmSync(backupDir, { recursive: true, force: true });
        }
        delete lockEntry.installPending;
      } catch {
        // Still can't apply — keep pending for next restart
        // Rollback backup if we managed the first rename
        if (existsSync(backupDir) && !existsSync(installDir)) {
          try {
            renameSync(backupDir, installDir);
          } catch {
            // best effort rollback
          }
        }
      }
    }
  }

  private processPendingUninstalls(): void {
    const retained: PluginLockEntry[] = [];
    for (const lockEntry of this.lockDocument.plugins) {
      if (lockEntry.uninstallPending !== true) {
        retained.push(lockEntry);
        continue;
      }

      const paths = new Set<string>([
        pluginInstallDir(this.options.pluginsDir, lockEntry.id),
        lockEntry.source.path
      ]);
      let fullyRemoved = true;
      for (const targetPath of paths) {
        if (!targetPath || !existsSync(targetPath)) {
          continue;
        }
        try {
          rmSync(targetPath, { recursive: true, force: true });
        } catch {
          fullyRemoved = false;
        }
      }

      if (fullyRemoved) {
        continue;
      }

      lockEntry.enabled = false;
      lockEntry.restartRequired = true;
      retained.push(lockEntry);
    }

    this.lockDocument.plugins = retained;
  }

  private async refresh(options: { clearRestartRequired?: boolean } = {}): Promise<void> {
    mkdirSync(this.options.pluginsDir, { recursive: true });
    this.lockDocument = this.readLockDocument();
    if (options.clearRestartRequired) {
      for (const plugin of this.lockDocument.plugins) {
        plugin.restartRequired = false;
      }
    }

    if (options.clearRestartRequired) {
      this.processPendingInstalls();
      this.processPendingUninstalls();
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
          restartRequired: lockEntry.restartRequired === true,
          uninstallPending: lockEntry.uninstallPending === true,
          integrity: lockEntry.integrity,
          installSourcePath: lockEntry.installSourcePath
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
          restartRequired: lockEntry.restartRequired === true,
          uninstallPending: lockEntry.uninstallPending === true,
          integrity: lockEntry.integrity,
          installSourcePath: lockEntry.installSourcePath
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
  const integrity = candidate.integrity as Partial<PluginLockEntry["integrity"]> | undefined;
  const integrityValid =
    integrity === undefined ||
    (integrity.algorithm === "sha256" &&
      typeof integrity.archiveHash === "string" &&
      integrity.archiveHash.length > 0 &&
      typeof integrity.installedAt === "string" &&
      integrity.installedAt.length > 0);
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.name === "string" &&
    typeof candidate.version === "string" &&
    typeof candidate.enabled === "boolean" &&
    (candidate.uninstallPending === undefined || typeof candidate.uninstallPending === "boolean") &&
    (candidate.installPending === undefined ||
      (typeof candidate.installPending.stagingDir === "string" && candidate.installPending.stagingDir.length > 0)) &&
    candidate.source != null &&
    (candidate.source.type === "folder" || candidate.source.type === "zip") &&
    typeof candidate.source.path === "string" &&
    (candidate.installSourcePath === undefined || typeof candidate.installSourcePath === "string") &&
    integrityValid
  );
}

export function defaultPluginsLockfilePath(settingsDirPath: string): string {
  return join(settingsDirPath, "plugins-lock.json");
}

export function managedPluginDisplayPath(entry: ManagedPluginInventoryEntry): string {
  return entry.sourceType === "zip" ? basename(entry.sourcePath) : entry.sourcePath;
}

function pluginInstallDir(pluginsDir: string, pluginId: string): string {
  return join(pluginsDir, toPluginFolderName(normalizePluginId(pluginId)));
}

function normalizePluginId(pluginId: string): string {
  const trimmed = pluginId.trim();
  if (process.platform === "win32") {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

function isSamePath(left: string, right: string): boolean {
  if (process.platform === "win32") {
    return normalize(left).toLowerCase() === normalize(right).toLowerCase();
  }
  return normalize(left) === normalize(right);
}

function toPluginFolderName(pluginId: string): string {
  return pluginId.replace(/[\\/:*?"<>|]/g, "_");
}

async function extractArchiveToDirectory(archive: JSZip, destinationDir: string): Promise<void> {
  const entries = Object.values(archive.files).sort((left, right) => left.name.localeCompare(right.name));
  const normalizedDestination = normalize(destinationDir);
  for (const entry of entries) {
    if (entry.dir) {
      mkdirSync(join(destinationDir, entry.name), { recursive: true });
      continue;
    }

    const outputPath = join(destinationDir, normalize(entry.name));
    const normalizedOutputPath = normalize(outputPath);
    if (normalizedOutputPath !== normalizedDestination && !normalizedOutputPath.startsWith(normalizedDestination + sep)) {
      throw new Error(`Archive entry escapes destination directory: ${entry.name}`);
    }

    mkdirSync(dirname(normalizedOutputPath), { recursive: true });
    writeFileSync(normalizedOutputPath, await entry.async("nodebuffer"));
  }
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}
