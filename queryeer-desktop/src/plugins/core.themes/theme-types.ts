export type ThemeMode = "dark" | "light";

export type ThemeDefinition = {
  id: string;
  name: string;
  mode: ThemeMode;
  description?: string;
  tokens: Record<string, string>;
};

export type ThemeManifest = {
  id: string;
  name: string;
  mode: ThemeMode;
  description?: string;
  tokens: Record<string, string>;
};

export const ACTIVE_THEME_SETTING_ID = "core.themes.activeThemeId";
