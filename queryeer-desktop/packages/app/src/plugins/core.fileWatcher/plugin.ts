import type { Plugin } from "@queryeer/api/plugin/Plugin";

export const coreFileWatcherPlugin: Plugin = {
  manifest: {
    id: "core.fileWatcher",
    name: "Core File Watcher",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["fileWatcher.service"],
    description: "Platform file watcher service shared across plugins"
  },
  activate: () => {
    // Service is owned by the runtime; plugin activation is a boundary marker.
  }
};
