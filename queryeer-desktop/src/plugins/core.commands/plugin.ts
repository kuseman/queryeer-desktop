import type { Plugin } from "../../contracts/plugin/Plugin";

export const coreCommandsPlugin: Plugin = {
  manifest: {
    id: "core.commands",
    name: "Core Commands",
    version: "0.1.0",
    kind: "core",
    description: "Registers baseline shell commands"
  },
  activate: (context) => {
    context.commands.registerCommand({
      id: "core.commands.about",
      title: "Show About",
      category: "Help",
      handler: () => {
        console.info("Queryeer Electron shell v0.1.0");
      }
    });

    context.keybindings.registerKeybinding({
      id: "core.commands.keybinding.about",
      commandId: "core.commands.about",
      key: "F1",
      when: "global",
      scope: "global",
      order: 10
    });
  }
};
