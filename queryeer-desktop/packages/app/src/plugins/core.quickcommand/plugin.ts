import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getQuickCommandService } from "./service";
import "./quick-command.css";

export const coreQuickCommandPlugin: Plugin = {
  manifest: {
    id: "core.quickcommand",
    name: "Quick Command",
    version: "0.1.0",
    kind: "core",
    dependencies: ["core.commands"],
    providesCapabilities: ["quickcommand"],
    description: "VS Code-style command palette accessible from the title bar"
  },
  activate: (context) => {

    context.commands.registerCommand({
      id: "core.quickcommand.open",
      title: "Open Quick Command",
      category: "Quick Command",
      handler: () => {
        getQuickCommandService()?.open();
      }
    });
    context.keybindings.registerKeybinding({
      id: "core.quickcommand.open.shortcut",
      commandId: "core.quickcommand.open",
      key: "CmdOrCtrl+P",
      when: "global",
      scope: "global",
      order: 410
    });
  }
};
