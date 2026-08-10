import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { helloWorldPlugin } from "./plugin.js";

export const pluginModule: PluginModule = {
  manifest: helloWorldPlugin.manifest,
  plugin: helloWorldPlugin
};
