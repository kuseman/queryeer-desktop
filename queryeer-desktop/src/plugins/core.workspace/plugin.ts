import type { Plugin } from "../../contracts/plugin/Plugin";

export const coreWorkspacePlugin: Plugin = {
  manifest: {
    id: "core.workspace",
    name: "Core Workspace",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["workspace.session"],
    description: "Persists and restores session state (open files, active file, layout)"
  },
  activate: () => {
    // Service is owned by the runtime; plugin activation is a boundary marker.
  }
};
