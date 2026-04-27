import type { Plugin } from "../../contracts/plugin/Plugin";
import { initializeCoreSettingsService } from "./service";

export const coreSettingsPlugin: Plugin = {
  manifest: {
    id: "core.settings",
    name: "Core Settings",
    version: "0.1.0",
    kind: "core",
    dependencies: ["core.commands", "core.menu"],
    providesCapabilities: ["settings.registry"],
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
