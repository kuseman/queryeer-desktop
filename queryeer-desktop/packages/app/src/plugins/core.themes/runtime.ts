import type { ThemeService } from "./theme-service";

let themeService: ThemeService | null = null;

export function setThemeService(service: ThemeService): void {
  themeService = service;
}

export function getThemeService(): ThemeService | null {
  return themeService;
}
