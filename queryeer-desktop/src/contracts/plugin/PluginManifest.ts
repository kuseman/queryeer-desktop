export type PluginKind = "core" | "feature";

export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  kind: PluginKind;
  dependencies?: string[];
  providesCapabilities?: string[];
  requiredCapabilities?: string[];
  description?: string;
};
