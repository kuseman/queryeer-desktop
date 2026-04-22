import type { Plugin } from "../../contracts/plugin/Plugin";
import type { MimeCapability } from "../../contracts/files/FilesRegistry";

const EXTENSION_MIME_MAP: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  yaml: "application/yaml",
  yml: "application/yaml",
  xml: "application/xml",
  csv: "text/csv",
  log: "text/plain",
  sql: "application/sql"
};

const DEFAULT_CAPABILITIES: MimeCapability[] = [
  "backupable",
  "editable",
  "viewable"
];

export const coreFilesPlugin: Plugin = {
  manifest: {
    id: "core.files",
    name: "Core Files",
    version: "0.1.0",
    kind: "core",
    description: "Owns the frontend file registry and file entity lifecycle"
  },
  activate: (context) => {
    context.commands.registerCommand({
      id: "core.files.new",
      title: "New File",
      accelerator: "CmdOrCtrl+N",
      handler: async () => {
        console.log("New file command executed");
      }
    });

    context.commands.registerCommand({
      id: "core.files.open",
      title: "Open File",
      accelerator: "CmdOrCtrl+O",
      handler: async () => {
        console.log("Open file command executed");
      }
    });

    context.commands.registerCommand({
      id: "core.files.save",
      title: "Save File",
      accelerator: "CmdOrCtrl+S",
      handler: async () => {
        console.log("Save file command executed");
      }
    });

    context.commands.registerCommand({
      id: "core.files.saveAs",
      title: "Save As",
      accelerator: "CmdOrCtrl+Shift+S",
      handler: async () => {
        console.log("Save as command executed");
      }
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.new",
      label: "New",
      order: 11,
      parentId: "core.menu.file",
      commandId: "core.files.new"
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.open",
      label: "Open",
      order: 12,
      parentId: "core.menu.file",
      commandId: "core.files.open"
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.save",
      label: "Save",
      order: 13,
      parentId: "core.menu.file",
      commandId: "core.files.save"
    });

    context.menu.registerMenuItem({
      id: "core.files.menu.saveAs",
      label: "Save As",
      order: 14,
      parentId: "core.menu.file",
      commandId: "core.files.saveAs"
    });

    context.files.registerMimeResolver((_uri, hint) => {
      const extension = hint?.extension;
      if (!extension) {
        return undefined;
      }
      return EXTENSION_MIME_MAP[extension];
    });

    for (const [mimeType] of Object.entries(EXTENSION_MIME_MAP)) {
      context.files.capabilities.registerCapabilities(mimeType, DEFAULT_CAPABILITIES);
      context.files.capabilities.registerContentCategory(mimeType, "text");
    }
  }
};
