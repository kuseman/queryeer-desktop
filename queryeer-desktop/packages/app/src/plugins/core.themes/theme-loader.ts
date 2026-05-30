import type { ThemeDefinition, ThemeManifest } from "./theme-types";

function toFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

function isThemeMode(value: unknown): value is "dark" | "light" {
  return value === "dark" || value === "light";
}

function parseThemeManifest(raw: unknown): ThemeManifest | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string" || value.id.trim().length === 0) {
    return null;
  }
  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    return null;
  }
  if (!isThemeMode(value.mode)) {
    return null;
  }
  if (!value.tokens || typeof value.tokens !== "object" || Array.isArray(value.tokens)) {
    return null;
  }
  const tokens: Record<string, string> = {};
  for (const [key, tokenValue] of Object.entries(value.tokens)) {
    if (typeof tokenValue === "string") {
      tokens[key] = tokenValue;
    }
  }
  return {
    id: value.id,
    name: value.name,
    mode: value.mode,
    description: typeof value.description === "string" ? value.description : undefined,
    tokens
  };
}

export async function discoverCustomThemes(): Promise<ThemeDefinition[]> {
  const appDir = await window.appShell.getAppDir();
  const themesPath = `${appDir}/settings/themes`;
  const dirUri = toFileUri(themesPath);
  const dir = await window.appShell.readDir({ uri: dirUri });
  if (!dir.success) {
    return [];
  }

  const themes: ThemeDefinition[] = [];
  const candidates = dir.items
    .filter((item) => item.isFile && item.name.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const item of candidates) {
    const fileUri = toFileUri(`${themesPath}/${item.name}`);
    const loaded = await window.appShell.readFile(fileUri);
    if (!loaded.success) {
      continue;
    }
    try {
      const parsed = JSON.parse(loaded.content) as unknown;
      const manifest = parseThemeManifest(parsed);
      if (!manifest) {
        continue;
      }
      themes.push(manifest);
    } catch {
      // Ignore broken files, users can fix theme and reload.
    }
  }

  return themes;
}
