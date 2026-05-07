import type { Plugin } from "../../contracts/plugin/Plugin";
import React from "react";
import { KeybindingsSettingsRenderer } from "./KeybindingsSettingsRenderer";

void React;

export const coreCommandsPlugin: Plugin = {
  manifest: {
    id: "core.commands",
    name: "Core Commands",
    version: "0.1.0",
    kind: "core",
    providesCapabilities: ["commands.registry"],
    description: "Registers baseline shell commands"
  },
  activate: (context) => {
    context.settings.registerAdvancedRenderer({
      id: "core.commands.keybindings.renderer",
      render: (props) => React.createElement(KeybindingsSettingsRenderer, props)
    });

    context.settings.registerSettings({
      moduleId: "core.commands",
      title: "Keybindings",
      order: 20,
      settings: [
        {
          id: "core.commands.keybindings",
          moduleId: "core.commands",
          title: "Keyboard Shortcuts",
          description: "See conflicts, change commands, turn off bindings, and persist user overrides.",
          sectionPath: ["Settings", "Keyboard"],
          tags: ["keybindings", "shortcuts", "keyboard", "commands"],
          type: "json",
          defaultValue: {},
          advanced: {
            rendererId: "core.commands.keybindings.renderer"
          }
        }
      ]
    });
  }
};
