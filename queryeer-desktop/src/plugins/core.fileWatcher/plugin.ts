import type { Plugin } from "../../contracts/plugin/Plugin";

export const coreFileWatcherPlugin: Plugin = {
  manifest: {
    id: "core.fileWatcher",
    name: "Core File Watcher",
    version: "0.1.0",
    kind: "core",
    description: "Platform file watcher service shared across plugins"
  },
  activate: () => {
    // Service is owned by the runtime; plugin activation is a boundary marker.
  }
};
