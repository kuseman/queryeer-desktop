export type PluginManifestDiagnostics = {
  id: string;
  name?: string;
  version?: string;
  kind?: string;
  description?: string;
  modulePath: string;
  dependencies: string[];
  providesCapabilities: string[];
  requiredCapabilities: string[];
};

/** A plugin that was skipped or failed to activate, or a warning for one that activated. */
export type PluginProblem = {
  pluginId: string;
  state: "skipped" | "failed" | "warning";
  message: string;
};

export type PluginDiagnostics = {
  discoveredManifestIds: string[];
  /** The plugins that activated, in order. */
  activationOrder: string[];
  providedCapabilities: string[];
  pluginManifests: PluginManifestDiagnostics[];
  pluginProblems?: PluginProblem[];
  /** How long each plugin's `activate` took, in milliseconds, including plugins that failed. */
  activationDurations?: Record<string, number>;
  externalLoadErrors?: {
    pluginId: string;
    modulePath: string;
    message: string;
  }[];
};
