import type { Plugin } from "../../contracts/plugin/Plugin";

export const coreCommandsPlugin: Plugin = {
  manifest: {
    id: "core.commands",
    name: "Core Commands",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["commands.registry"],
    description: "Registers baseline shell commands"
  },
  activate: (_context) => {
  }
};
