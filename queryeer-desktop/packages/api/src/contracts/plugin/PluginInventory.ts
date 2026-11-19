export type ManagedPluginSourceType = "folder" | "zip";

export type ManagedPluginRuntimeStatus = "available" | "missing" | "invalid";

export type ManagedPluginInventoryEntry = {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  sourcePath: string;
  sourceType: ManagedPluginSourceType;
  status: ManagedPluginRuntimeStatus;
  hasFrontend: boolean;
  hasBackend: boolean;
  lastError?: string;
  restartRequired?: boolean;
  uninstallPending?: boolean;
  integrity?: {
    algorithm: "sha256";
    archiveHash: string;
    installedAt: string;
  };
  installSourcePath?: string;
};

export type ManagedPluginInventory = {
  pluginsDir: string;
  lockfilePath: string;
  safeMode: boolean;
  plugins: ManagedPluginInventoryEntry[];
  /** Developer plugin folders, when `QUERYEER_DEV_PLUGINS` lists any. */
  developmentPlugins?: DevelopmentPluginEntry[];
};

/**
 * A plugin loaded in place from a developer folder listed in the `QUERYEER_DEV_PLUGINS` environment variable. Not
 * installed and not in the lockfile: always enabled, and it replaces an installed plugin with the same id.
 */
export type DevelopmentPluginEntry = {
  id: string;
  name: string;
  version: string;
  sourcePath: string;
  hasFrontend: boolean;
  hasBackend: boolean;
  /** Why the folder can't be loaded. */
  error?: string;
};

export type ManagedPluginSetEnabledResult = {
  accepted: boolean;
  restartRequired: boolean;
  plugin?: ManagedPluginInventoryEntry;
  reason?: string;
};

export type ManagedPluginInstallResult = {
  accepted: boolean;
  restartRequired: boolean;
  plugin?: ManagedPluginInventoryEntry;
  reason?: string;
};

export type ManagedPluginUninstallResult = {
  accepted: boolean;
  restartRequired: boolean;
  removedPluginId?: string;
  reason?: string;
};
