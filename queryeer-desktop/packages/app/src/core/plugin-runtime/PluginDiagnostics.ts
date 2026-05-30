export type PluginManifestDiagnostics = {
  id: string;
  modulePath: string;
  dependencies: string[];
  providesCapabilities: string[];
  requiredCapabilities: string[];
};

export type PluginDiagnostics = {
  discoveredManifestIds: string[];
  activationOrder: string[];
  providedCapabilities: string[];
  pluginManifests: PluginManifestDiagnostics[];
  externalLoadErrors?: {
    pluginId: string;
    modulePath: string;
    message: string;
  }[];
};
