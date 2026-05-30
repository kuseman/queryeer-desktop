import type { ThemeManifest } from "./theme-types";

function toFileUri(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

async function themesDirPath(): Promise<string> {
  const appDir = await window.appShell.getAppDir();
  return `${appDir}/settings/themes`;
}

export async function listThemeFiles(): Promise<string[]> {
  const dirPath = await themesDirPath();
  const result = await window.appShell.readDir({ uri: toFileUri(dirPath) });
  if (!result.success) {
    return [];
  }
  return result.items
    .filter((item) => item.isFile && item.name.toLowerCase().endsWith(".json"))
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function saveThemeManifest(fileName: string, manifest: ThemeManifest): Promise<void> {
  const dirPath = await themesDirPath();
  const uri = toFileUri(`${dirPath}/${fileName}`);
  const content = JSON.stringify(manifest, null, 2);
  const result = await window.appShell.writeFile(uri, content);
  if (!result.success) {
    throw new Error("Failed to write theme file");
  }
}

export async function readThemeManifest(fileName: string): Promise<ThemeManifest | null> {
  const dirPath = await themesDirPath();
  const uri = toFileUri(`${dirPath}/${fileName}`);
  const result = await window.appShell.readFile(uri);
  if (!result.success) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.content) as ThemeManifest;
    if (
      typeof parsed?.id === "string" &&
      typeof parsed?.name === "string" &&
      (parsed?.mode === "dark" || parsed?.mode === "light") &&
      parsed.tokens &&
      typeof parsed.tokens === "object"
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export async function deleteThemeFile(fileName: string): Promise<void> {
  const dirPath = await themesDirPath();
  const uri = toFileUri(`${dirPath}/${fileName}`);
  const result = await window.appShell.writeFile(uri, "");
  if (!result.success) {
    throw new Error("Failed to clear theme file");
  }
}
