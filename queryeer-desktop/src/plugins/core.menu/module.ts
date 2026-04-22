import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreMenuPlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreMenuPlugin.manifest,
  plugin: coreMenuPlugin
};
