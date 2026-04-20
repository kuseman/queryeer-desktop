import type { Plugin } from "../../contracts/plugin/Plugin";

export const coreFileSystemPlugin: Plugin = {
  manifest: {
    id: "core.filesystem",
    name: "Core Filesystem",
    version: "0.1.0",
    kind: "core",
    description: "Registers local filesystem scheme"
  },
  activate: (context) => {
    context.filesystems.registerFileSystem({
      id: "core.filesystem.local",
      title: "Local Filesystem",
      schemes: ["file"]
    });
  }
};
