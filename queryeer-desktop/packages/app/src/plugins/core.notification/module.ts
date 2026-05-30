import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
import { coreNotificationPlugin } from "./plugin";
import "./notification.css";

export const pluginModule: PluginModule = {
  manifest: coreNotificationPlugin.manifest,
  plugin: coreNotificationPlugin
};
