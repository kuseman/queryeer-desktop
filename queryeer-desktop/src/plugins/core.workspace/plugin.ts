import type { Plugin } from "../../contracts/plugin/Plugin";
import { getQuickCommandService } from "../core.quickcommand/service";
import "../../contracts/shell/Api";

function getFileName(uri: string): string {
  return uri.replace(/\\/g, "/").split("/").pop() ?? uri;
}

function getDisplayPath(uri: string): string {
  return uri.replace(/^file:\/\//, "").replace(/\\/g, "/");
}

export const coreWorkspacePlugin: Plugin = {
  manifest: {
    id: "core.workspace",
    name: "Core Workspace",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["workspace.session"],
    description: "Persists and restores session state (open files, active file, layout)"
  },
  activate: (context) => {
    context.quickcommand.registerProvider({
      prefix: "#",
      label: "Open Files",
      order: 5,
      getItems: (_query, ctx) =>
        ctx.openFiles.map((file) => ({
          id: `workspace.openFile.${file.fileId}`,
          title: getFileName(file.uri),
          description: getDisplayPath(file.uri),
          action: () => {
            context.fileMediator.setActiveFileId(file.fileId);
          }
        }))
    });

    context.quickcommand.registerProvider({
      prefix: "#",
      label: "Recent Files",
      order: 10,
      getItems: async () => {
        const entries = await window.appShell.getRecentFiles();
        return entries.map((entry) => ({
          id: `workspace.recentFile.${entry.uri}`,
          title: getFileName(entry.uri),
          description: getDisplayPath(entry.uri),
          action: async () => {
            await context.fileMediator.openFile(entry.uri);
          }
        }));
      }
    });

    context.commands.registerCommand({
      id: "core.quickcommand.open.files",
      title: "Open Quick Command",
      category: "Quick Command",
      handler: () => {
        getQuickCommandService()?.open("#");
      }
    });

    context.keybindings.registerKeybinding({
      id: "core.quickcommand.open.files",
      commandId: "core.quickcommand.open.files",
      key: "F1",
      when: "global",
      scope: "global",
      order: 10
    });
  }
};
