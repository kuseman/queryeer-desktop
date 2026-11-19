import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { basename, delimiter, join, resolve } from "node:path";
import type { DevelopmentPluginEntry } from "@queryeer/api/plugin/PluginInventory.js";

/**
 * Developer plugin folders (API-GAPS D1): plugin folders loaded in place, next to the managed plugins directory.
 * Each folder is one plugin, laid out like an installed one (`plugin.json`, `lib/*.jar`, the frontend bundle).
 *
 * Kept free of Electron imports: `electron.vite.config.ts` reads the same variable to allow the folders in the dev server.
 */
export const DEV_PLUGINS_ENV = "QUERYEER_DEV_PLUGINS";

/**
 * Id prefixes of the built-in plugins: `core.` in the frontend, `queryengine.` in the backend. A developer folder can't
 * use them, since a built-in plugin can't be replaced, and refusing it on both sides keeps the halves together.
 */
const RESERVED_ID_PREFIXES = ["core.", "queryengine."];

/** The folders listed in `QUERYEER_DEV_PLUGINS`, separated like `PATH` (`;` on Windows, `:` elsewhere): absolute, without duplicates. */
export function parseDevPluginFolders(value: string | undefined, separator: string = delimiter): string[] {
  if (!value) {
    return [];
  }
  const folders: string[] = [];
  for (const item of value.split(separator)) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const folder = resolve(trimmed);
    if (!folders.includes(folder)) {
      folders.push(folder);
    }
  }
  return folders;
}

/**
 * What each developer folder's `plugin.json` declares, and why a folder can't be loaded. Read on every call, so a
 * rebuilt `plugin.json` counts on the next backend start or window load.
 */
export function describeDevPluginFolders(folders: string[]): DevelopmentPluginEntry[] {
  const seenIds = new Set<string>();
  return folders.map((folder) => {
    const entry = describeFolder(folder);
    if (entry.error) {
      return entry;
    }
    if (RESERVED_ID_PREFIXES.some((prefix) => entry.id.startsWith(prefix))) {
      return { ...entry, error: `Ids starting with ${RESERVED_ID_PREFIXES.join(" or ")} belong to built-in plugins, which can't be replaced` };
    }
    if (seenIds.has(entry.id)) {
      return { ...entry, error: `An earlier folder in ${DEV_PLUGINS_ENV} has the same id` };
    }
    seenIds.add(entry.id);
    return entry;
  });
}

/** The developer folders that load: valid `plugin.json`, no reserved id, first folder per id. */
export function loadableDevPlugins(folders: string[]): DevelopmentPluginEntry[] {
  return describeDevPluginFolders(folders).filter((entry) => !entry.error);
}

function describeFolder(folder: string): DevelopmentPluginEntry {
  const fallback = { id: basename(folder), name: basename(folder), version: "", sourcePath: folder, hasFrontend: false, hasBackend: false };
  const manifestPath = join(folder, "plugin.json");
  if (!existsSync(manifestPath)) {
    return { ...fallback, error: "No plugin.json in this folder" };
  }
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      id?: unknown;
      name?: unknown;
      version?: unknown;
      frontend?: { entryModule?: unknown };
      backend?: unknown;
    };
    if (typeof parsed.id !== "string" || parsed.id.length === 0) {
      return { ...fallback, error: "plugin.json has no id" };
    }
    const entryModule = parsed.frontend?.entryModule;
    const entry: DevelopmentPluginEntry = {
      id: parsed.id,
      name: typeof parsed.name === "string" ? parsed.name : parsed.id,
      version: typeof parsed.version === "string" ? parsed.version : "",
      sourcePath: folder,
      hasFrontend: typeof entryModule === "string" && entryModule.length > 0,
      hasBackend: typeof parsed.backend === "object" && parsed.backend !== null
    };
    if (entry.hasFrontend && !existsSync(resolve(folder, entryModule as string))) {
      return { ...entry, error: `The frontend module ${String(entryModule)} doesn't exist (not built yet?)` };
    }
    return entry;
  } catch (error) {
    return { ...fallback, error: `plugin.json can't be read: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/**
 * Copies the developer folders before each backend start, and the backend loads the copies. The JVM keeps the jars it
 * loaded open, and on Windows that locks them; loading copies keeps the developer's build output writable, so a
 * rebuild followed by a backend restart picks up the new jars (API-GAPS D3, for developer folders only).
 *
 * `root` is in Queryeer's own app data, not the shared temp folder, so no other user can place files where the backend
 * loads jars from.
 */
export class DevPluginShadowCopier {
  private run = 0;

  public constructor(
    private readonly folders: () => string[],
    private readonly options: {
      root: string;
      pid?: number;
      isProcessAlive?: (pid: number) => boolean;
      log?: (message: string) => void;
    }
  ) {}

  /**
   * Copies every folder and returns the copies, in the order of `folders`. A folder that can't be copied is skipped and
   * logged, so the backend still starts. Earlier copies are removed.
   */
  public prepare(): string[] {
    const folders = this.folders();
    if (folders.length === 0) {
      return [];
    }
    const { root } = this.options;
    const pid = this.options.pid ?? process.pid;
    this.removeStaleCopies(root, pid);

    this.run += 1;
    const runDir = join(root, `${pid}-${this.run}`);
    mkdirSync(runDir, { recursive: true });
    const copies: string[] = [];
    folders.forEach((folder, index) => {
      const target = join(runDir, `${index}-${basename(folder)}`);
      try {
        // Links are copied as files: a linked jar would otherwise still be loaded, and locked, at its target
        cpSync(folder, target, { recursive: true, dereference: true });
        copies.push(target);
      } catch (error) {
        this.options.log?.(`[plugins] developer folder ${folder} not loaded in the backend: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    return copies;
  }

  /** This process's earlier runs (their backend has exited) and runs of processes that are gone. Locked copies are left for later. */
  private removeStaleCopies(root: string, pid: number): void {
    if (!existsSync(root)) {
      return;
    }
    const isAlive = this.options.isProcessAlive ?? isProcessAlive;
    for (const name of readdirSync(root)) {
      const match = /^(\d+)-\d+$/.exec(name);
      if (!match) {
        continue;
      }
      const owner = Number(match[1]);
      if (owner !== pid && isAlive(owner)) {
        continue;
      }
      try {
        rmSync(join(root, name), { recursive: true, force: true });
      } catch {
        // Still locked by a backend that hasn't exited yet; removed on a later start
      }
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
