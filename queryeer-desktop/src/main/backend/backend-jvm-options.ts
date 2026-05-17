import { readFile } from "node:fs/promises";
import { join } from "node:path";

const SETTINGS_MODULE_ID = "core.backend";
const JVM_ARGS_SETTING_ID = "core.backend.jvmArgs";

export const DEFAULT_BACKEND_JVM_ARGS = ["-Xms64m", "-Xmx512m"] as const;

export async function resolveBackendJvmArgs(settingsDirPath?: string): Promise<string[]> {
  const envArgs = process.env.QUERYEER_BACKEND_JVM_ARGS?.trim();
  if (envArgs) {
    return parseJvmArgs(envArgs);
  }

  const settingsArgs = settingsDirPath ? await readJvmArgsFromSettings(settingsDirPath) : [];
  return settingsArgs.length > 0 ? settingsArgs : [...DEFAULT_BACKEND_JVM_ARGS];
}

export function parseJvmArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (current) {
    args.push(current);
  }
  return args;
}

async function readJvmArgsFromSettings(settingsDirPath: string): Promise<string[]> {
  try {
    const raw = await readFile(join(settingsDirPath, `${SETTINGS_MODULE_ID}.json`), "utf8");
    const parsed = JSON.parse(raw) as { values?: Record<string, unknown> };
    const value = parsed.values?.[JVM_ARGS_SETTING_ID];
    return typeof value === "string" ? parseJvmArgs(value) : [];
  } catch {
    return [];
  }
}
