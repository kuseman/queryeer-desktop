export const SETTINGS_INDEX_VERSION = 1;
export const SETTINGS_MODULE_VERSION = 1;

export type SettingsIndexModuleEntry = {
  file: string;
  version: number;
  updatedAt: string;
};

export type SettingsIndexDocument = {
  version: typeof SETTINGS_INDEX_VERSION;
  updatedAt: string;
  modules: Record<string, SettingsIndexModuleEntry>;
};

export type SettingsModuleDocument = {
  version: typeof SETTINGS_MODULE_VERSION;
  moduleId: string;
  updatedAt: string;
  values: Record<string, unknown>;
};

export function emptySettingsIndexDocument(): SettingsIndexDocument {
  return {
    version: SETTINGS_INDEX_VERSION,
    updatedAt: new Date(0).toISOString(),
    modules: {}
  };
}

export function emptySettingsModuleDocument(moduleId: string): SettingsModuleDocument {
  return {
    version: SETTINGS_MODULE_VERSION,
    moduleId,
    updatedAt: new Date(0).toISOString(),
    values: {}
  };
}
