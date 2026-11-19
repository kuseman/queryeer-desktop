import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevPluginShadowCopier, describeDevPluginFolders, loadableDevPlugins, parseDevPluginFolders } from "./dev-plugin-folders.js";
import { discoverFrontendPluginFolders } from "./frontend-plugin-discovery.js";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "queryeer-dev-plugins-test-"));
  tempRoots.push(root);
  return root;
}

function writePlugin(root: string, folderName: string, manifest: object): string {
  const pluginDir = join(root, folderName);
  mkdirSync(join(pluginDir, "lib"), { recursive: true });
  mkdirSync(join(pluginDir, "frontend"), { recursive: true });
  writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify(manifest));
  writeFileSync(join(pluginDir, "lib", "plugin.jar"), "jar v1");
  writeFileSync(join(pluginDir, "frontend", "index.js"), "export const pluginModule = {};\n");
  return pluginDir;
}

const manifest = {
  schemaVersion: 1,
  id: "com.example.dev",
  name: "Example",
  version: "0.1.0",
  frontend: { entryModule: "frontend/index.js" },
  backend: { entryClass: "com.example.Plugin" }
};

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("dev-plugin-folders", () => {
  it("reads the folders separated like PATH, absolute and without duplicates", () => {
    expect(parseDevPluginFolders(undefined)).toEqual([]);
    expect(parseDevPluginFolders(" a ; ;b;a", ";")).toEqual([resolve("a"), resolve("b")]);
  });

  it("describes each folder for the plugin list, and says why one can't be loaded", () => {
    const root = createTempRoot();
    const plugin = writePlugin(root, "example", manifest);
    const empty = join(root, "empty");
    mkdirSync(empty);

    expect(describeDevPluginFolders([plugin, empty])).toEqual([
      { id: "com.example.dev", name: "Example", version: "0.1.0", sourcePath: plugin, hasFrontend: true, hasBackend: true },
      { id: "empty", name: "empty", version: "", sourcePath: empty, hasFrontend: false, hasBackend: false, error: "No plugin.json in this folder" }
    ]);
  });

  it("refuses built-in ids, a second folder with the same id, and a frontend that isn't built", () => {
    const root = createTempRoot();
    const builtin = writePlugin(root, "builtin", { ...manifest, id: "queryengine.jdbc.dialect.postgres" });
    const core = writePlugin(root, "core", { ...manifest, id: "core.menu" });
    const first = writePlugin(root, "first", manifest);
    const second = writePlugin(root, "second", manifest);
    const unbuilt = writePlugin(root, "unbuilt", { ...manifest, id: "com.example.unbuilt", frontend: { entryModule: "frontend/missing.js" } });

    const errors = describeDevPluginFolders([builtin, core, first, second, unbuilt]).map((entry) => entry.error);
    expect(errors[0]).toMatch(/built-in/);
    expect(errors[1]).toMatch(/built-in/);
    expect(errors[2]).toBeUndefined();
    expect(errors[3]).toMatch(/same id/);
    expect(errors[4]).toMatch(/doesn't exist/);
    expect(loadableDevPlugins([builtin, core, first, second, unbuilt]).map((entry) => entry.sourcePath)).toEqual([first]);
  });

  it("finds the frontend of each folder in place", () => {
    const root = createTempRoot();
    const plugin = writePlugin(root, "example", manifest);

    expect(discoverFrontendPluginFolders([plugin, join(root, "missing")])).toEqual([
      expect.objectContaining({ id: "com.example.dev", modulePath: join(plugin, "frontend", "index.js"), sourcePath: plugin })
    ]);
  });

  it("copies the folders for each backend start, so the build output stays writable, and removes earlier copies", () => {
    const root = createTempRoot();
    const plugin = writePlugin(root, "example", manifest);
    const shadowRoot = join(root, "shadow");
    const log = vi.fn();
    const copier = new DevPluginShadowCopier(() => [plugin, join(root, "missing")], { root: shadowRoot, pid: 42, isProcessAlive: () => false, log });

    // The missing folder can't be copied: skipped and logged, the backend still gets the others
    const [first, ...rest] = copier.prepare();
    expect(rest).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("not loaded in the backend"));
    expect(readFileSync(join(first, "lib", "plugin.jar"), "utf8")).toBe("jar v1");

    writeFileSync(join(plugin, "lib", "plugin.jar"), "jar v2");
    const second = copier.prepare();
    expect(second).toHaveLength(1);
    expect(readFileSync(join(second[0], "lib", "plugin.jar"), "utf8")).toBe("jar v2");
    expect(existsSync(first)).toBe(false);
    expect(readdirSync(shadowRoot)).toEqual(["42-2"]);
  });

  it("leaves the copies of another running Queryeer alone", () => {
    const root = createTempRoot();
    const plugin = writePlugin(root, "example", manifest);
    const shadowRoot = join(root, "shadow");
    mkdirSync(join(shadowRoot, "7-1"), { recursive: true });
    mkdirSync(join(shadowRoot, "8-1"), { recursive: true });

    new DevPluginShadowCopier(() => [plugin], { root: shadowRoot, pid: 42, isProcessAlive: (pid) => pid === 7 }).prepare();

    expect(readdirSync(shadowRoot).sort()).toEqual(["42-1", "7-1"]);
  });
});
