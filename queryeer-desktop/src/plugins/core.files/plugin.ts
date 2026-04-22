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
