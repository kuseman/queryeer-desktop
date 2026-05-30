import type { Plugin } from "@queryeer/api/plugin/Plugin";
import { getCoreSettingsService } from "../core.settings/service";
import { ThemeSettingsEditor } from "./ThemeSettingsEditor";
import { ThemeStudioSettingsEditor } from "./ThemeStudioSettingsEditor";
import { setThemeService } from "./runtime";
import { ThemeService } from "./theme-service";
import { ACTIVE_THEME_SETTING_ID } from "./theme-types";

export const coreThemesPlugin: Plugin = {
  manifest: {
    id: "core.themes",
    name: "Core Themes",
    version: "0.1.0",
    kind: "core",
    description: "Application theme support with built-in and custom themes",
    dependencies: ["core.settings"],
    providesCapabilities: ["themes"]
  },
  activate: (context) => {
    const settingsService = getCoreSettingsService();
    if (!settingsService) {
      return;
    }

    const themeService = new ThemeService(settingsService);
    setThemeService(themeService);

    context.settings.registerAdvancedRenderer({
      id: "core.themes.activeThemeId.renderer",
      render: ({ value, setValue, readonly }) => (
        <ThemeSettingsEditor value={value} setValue={setValue} readonly={readonly} />
      )
    });
    context.settings.registerAdvancedRenderer({
      id: "core.themes.studio.renderer",
      render: () => <ThemeStudioSettingsEditor />
    });

    context.settings.registerSettings({
      moduleId: "core.themes",
      title: "Themes",
      order: 11,
      settings: [
        {
          id: ACTIVE_THEME_SETTING_ID,
          moduleId: "core.themes",
          title: "Active Theme",
          description: "Select active application theme. Custom themes can be stored in appDir/settings/themes.",
          sectionPath: ["Appearance", "Themes"],
          tags: ["theme", "appearance", "light", "dark"],
          type: "string",
          defaultValue: "queryeer.dark",
          advanced: {
            rendererId: "core.themes.activeThemeId.renderer"
          }
        },
        {
          id: "core.themes.studio",
          moduleId: "core.themes",
          title: "Build Your Own Themes",
          description: "Create and edit distributable themes stored in appDir/settings/themes.",
          sectionPath: ["Appearance", "Themes", "Custom"],
          tags: ["theme", "custom", "tokens"],
          type: "json",
          defaultValue: {},
          advanced: {
            rendererId: "core.themes.studio.renderer"
          }
        }
      ]
    });

    settingsService.refreshSchemaFromRegistry();
    void settingsService.syncRegistryModules().then(() => themeService.initialize());

    context.commands.registerCommand({
      id: "core.themes.reloadCustomThemes",
      title: "Reload Themes",
      category: "Preferences",
      handler: async () => {
        await themeService.reloadThemes();
      }
    });
  }
};
