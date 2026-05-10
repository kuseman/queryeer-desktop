import { BUILT_IN_THEMES } from "./built-in-themes";
import { discoverCustomThemes } from "./theme-loader";
import { ACTIVE_THEME_SETTING_ID, type ThemeDefinition } from "./theme-types";

type ThemeReader = {
  getValue: (settingId: string) => unknown;
  subscribe: (listener: () => void) => () => void;
};

const DEFAULT_THEME_ID = "queryeer.dark";

export class ThemeService {
  private readonly reader: ThemeReader;
  private themes = new Map<string, ThemeDefinition>();
  private activeThemeId = DEFAULT_THEME_ID;
  private readonly subscribers = new Set<() => void>();
  private unsubscribeFromSettings: (() => void) | null = null;

  public constructor(reader: ThemeReader) {
    this.reader = reader;
  }

  public async initialize(): Promise<void> {
    await this.reloadThemes();
    this.applyThemeFromSettings();
    this.unsubscribeFromSettings = this.reader.subscribe(() => {
      this.applyThemeFromSettings();
    });
  }

  public dispose(): void {
    this.unsubscribeFromSettings?.();
    this.unsubscribeFromSettings = null;
  }

  public subscribe(listener: () => void): () => void {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  public listThemes(): ThemeDefinition[] {
    return [...this.themes.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  public getActiveTheme(): ThemeDefinition {
    return this.themes.get(this.activeThemeId) ?? this.themes.get(DEFAULT_THEME_ID) ?? BUILT_IN_THEMES[0];
  }

  public getActiveThemeMode(): "dark" | "light" {
    return this.getActiveTheme().mode;
  }

  public async reloadThemes(): Promise<void> {
    const merged = new Map<string, ThemeDefinition>();
    for (const theme of BUILT_IN_THEMES) {
      merged.set(theme.id, theme);
    }
    const custom = await discoverCustomThemes();
    for (const theme of custom) {
      if (!merged.has(theme.id)) {
        merged.set(theme.id, theme);
      }
    }
    this.themes = merged;
    this.applyThemeFromSettings();
    this.emit();
  }

  private applyThemeFromSettings(): void {
    const configuredThemeId = this.reader.getValue(ACTIVE_THEME_SETTING_ID);
    const themeId = typeof configuredThemeId === "string" ? configuredThemeId : DEFAULT_THEME_ID;
    this.activeThemeId = this.themes.has(themeId) ? themeId : DEFAULT_THEME_ID;
    const theme = this.getActiveTheme();
    const root = document.documentElement;
    root.setAttribute("data-theme-id", theme.id);
    root.style.setProperty("color-scheme", theme.mode);
    for (const [name, value] of Object.entries(theme.tokens)) {
      root.style.setProperty(name, value);
    }
    this.emit();
  }

  private emit(): void {
    for (const subscriber of this.subscribers) {
      subscriber();
    }
  }
}
