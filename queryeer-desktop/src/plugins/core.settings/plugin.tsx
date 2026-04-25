import type { Plugin } from "../../contracts/plugin/Plugin";
import { initializeCoreSettingsService } from "./service";

export const coreSettingsPlugin: Plugin = {
  manifest: {
    id: "core.settings",
    name: "Core Settings",
    version: "0.1.0",
    kind: "core",
    description: "Central settings registry, persistence, and settings dialog foundation"
  },
  activate: async (context) => {
    context.settings.registerSettings({
      moduleId: "core.settings",
      title: "Settings",
      order: 10,
      settings: [
        {
          id: "core.settings.search.caseSensitive",
          moduleId: "core.settings",
          title: "Search Case Sensitive",
          description: "Match setting search by case in the settings dialog.",
          sectionPath: ["Settings", "Search"],
          tags: ["search", "filter"],
          type: "boolean",
          defaultValue: false
        },
        {
          id: "core.settings.secrets.placeholder",
          moduleId: "core.settings",
          title: "Secret Storage",
          description: "Placeholder field showing that secure secret storage is not yet available.",
          sectionPath: ["Settings", "Security"],
          tags: ["secret", "key", "token"],
          type: "string",
          defaultValue: "",
          isSecret: true
        }
      ]
    });

    const service = await initializeCoreSettingsService(context.settings);

    context.commands.registerCommand({
      id: "core.settings.open",
      title: "Open Settings",
      category: "Preferences",
      handler: () => {
        service.openModal();
      }
    });

    context.keybindings.registerKeybinding({
      id: "core.settings.keybinding.open",
      commandId: "core.settings.open",
      key: "CmdOrCtrl+,",
      when: "global",
      scope: "global",
      order: 430
    });

    context.menu.registerMenuItem({
      id: "core.menu.options.settings",
      label: "Settings",
      order: 20,
      parentId: "core.menu.options",
      commandId: "core.settings.open",
      accelerator: "CmdOrCtrl+,"
    });
  }
};
