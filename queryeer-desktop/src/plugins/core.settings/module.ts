import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreSettingsPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreSettingsPlugin.manifest,
  plugin: coreSettingsPlugin
};
