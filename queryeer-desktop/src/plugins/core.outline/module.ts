import type { PluginModule } from "../../contracts/plugin/PluginModule";
import { coreOutlinePlugin } from "./plugin";

export const pluginModule: PluginModule = {
  manifest: coreOutlinePlugin.manifest,
  plugin: coreOutlinePlugin
};
