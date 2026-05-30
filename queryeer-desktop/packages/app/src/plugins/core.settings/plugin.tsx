import type { Plugin } from "@queryeer/api/plugin/Plugin";
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

    context.settings.registerSettings({
      moduleId: "core.backend",
      title: "Backend",
      order: 20,
      settings: [
        {
          id: "core.backend.jvmArgs",
          moduleId: "core.backend",
          title: "JVM Arguments",
          description: "Arguments used when starting the Java backend. Defaults to -Xms64m -Xmx512m. Restart the backend/app after changing this setting.",
          sectionPath: ["Backend", "Java"],
          tags: ["java", "jvm", "memory", "xmx", "xms"],
          type: "string",
          defaultValue: "-Xms64m -Xmx512m"
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
      id: "core.menu.tools.settings",
      label: "Settings",
      order: 20,
      parentId: "core.menu.tools",
      commandId: "core.settings.open",
    });
  }
};
