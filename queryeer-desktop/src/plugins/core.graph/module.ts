import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreGraphPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreGraphPlugin.manifest,
  plugin: coreGraphPlugin
};
