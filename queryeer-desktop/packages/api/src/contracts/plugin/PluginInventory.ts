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
};

export type ManagedPluginInventory = {
  pluginsDir: string;
  lockfilePath: string;
  safeMode: boolean;
  plugins: ManagedPluginInventoryEntry[];
};

export type ManagedPluginSetEnabledResult = {
  accepted: boolean;
  restartRequired: boolean;
  plugin?: ManagedPluginInventoryEntry;
  reason?: string;
};
