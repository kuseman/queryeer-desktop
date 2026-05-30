export type SettingsIndexModuleEntry = {
  file: string;
  version: number;
  updatedAt: string;
};

export type SettingsIndexDocument = {
  version: number;
  updatedAt: string;
  modules: Record<string, SettingsIndexModuleEntry>;
};

export type SettingsModuleDocument = {
  version: number;
  moduleId: string;
  updatedAt: string;
  values: Record<string, unknown>;
};

export function emptySettingsIndexDocument(): SettingsIndexDocument {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    modules: {}
  };
}

export function emptySettingsModuleDocument(moduleId: string): SettingsModuleDocument {
  return {
    version: 1,
    moduleId,
    updatedAt: new Date(0).toISOString(),
    values: {}
  };
}
