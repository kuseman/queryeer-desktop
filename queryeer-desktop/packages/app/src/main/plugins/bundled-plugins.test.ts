import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUNDLED_PLUGINS_LOCK_FILE, parseBundledPluginsLock, planBundledPlugin, resolveBundledPluginsDir } from "./bundled-plugins.js";
import { PluginInventoryService } from "./plugin-inventory-service.js";

const entry = { id: "com.example.one", version: "0.2.0", file: "com.example.one-0.2.0.zip", sha256: "abc" };

describe("parseBundledPluginsLock", () => {
  it("reads the plugins", () => {
    expect(parseBundledPluginsLock(JSON.stringify({ schemaVersion: 1, plugins: [{ ...entry, url: "https://example.com/one.zip" }] })).plugins).toEqual([
      { ...entry, url: "https://example.com/one.zip" }
    ]);
  });

  it("refuses another format, a missing field and a file outside the folder", () => {
    expect(() => parseBundledPluginsLock(JSON.stringify({ schemaVersion: 2, plugins: [] }))).toThrow(/schemaVersion 1/);
    expect(() => parseBundledPluginsLock(JSON.stringify({ schemaVersion: 1, plugins: [{ ...entry, sha256: "" }] }))).toThrow(/has no sha256/);
    expect(() => parseBundledPluginsLock(JSON.stringify({ schemaVersion: 1, plugins: [{ ...entry, file: "../evil.zip" }] }))).toThrow(/outside its folder/);
    expect(() => parseBundledPluginsLock(JSON.stringify({ schemaVersion: 1, plugins: [entry, { ...entry, id: "COM.example.one" }] }))).toThrow(/listed twice/);
  });
});

describe("planBundledPlugin", () => {
  it("installs a missing plugin and upgrades an older one", () => {
    expect(planBundledPlugin(entry, undefined, false)).toBe("install");
    expect(planBundledPlugin(entry, { version: "0.1.0", uninstallPending: false }, false)).toBe("upgrade");
  });

  it("leaves the same or a newer version, and never downgrades", () => {
    expect(planBundledPlugin(entry, { version: "0.2.0", uninstallPending: false }, false)).toEqual({ id: entry.id, version: "0.2.0", previousVersion: "0.2.0", result: "unchanged" });
    expect(planBundledPlugin(entry, { version: "0.3.0", uninstallPending: false }, false)).toMatchObject({
      result: "unchanged",
      reason: "0.3.0 is newer than the bundled 0.2.0"
    });
  });

  it("leaves a plugin the user uninstalled, or is uninstalling", () => {
    expect(planBundledPlugin(entry, undefined, true)).toMatchObject({ result: "uninstalled-by-user" });
    expect(planBundledPlugin(entry, { version: "0.1.0", uninstallPending: true }, false)).toMatchObject({ result: "uninstalled-by-user" });
  });

  it("leaves a plugin whose version can't be compared", () => {
    expect(planBundledPlugin(entry, { version: "dev", uninstallPending: false }, false)).toMatchObject({ result: "unchanged", reason: expect.stringMatching(/^Cannot compare versions/) });
  });
});

describe("resolveBundledPluginsDir", () => {
  it("is in the packaged app's resources, or where QUERYEER_BUNDLED_PLUGINS_DIR says", () => {
    expect(resolveBundledPluginsDir("/app/resources", true, {})).toBe(join("/app/resources", "plugins", "bundled"));
    expect(resolveBundledPluginsDir("/app/resources", false, {})).toBeUndefined();
    expect(resolveBundledPluginsDir(undefined, false, { QUERYEER_BUNDLED_PLUGINS_DIR: "/tmp/bundle" })).toBe("/tmp/bundle");
  });
});

describe("PluginInventoryService.installBundled", () => {
  let root: string;
  let pluginsDir: string;
  let bundledDir: string;
  let lockfilePath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "queryeer-bundled-"));
    pluginsDir = join(root, "plugins");
    bundledDir = join(root, "bundled");
    lockfilePath = join(root, "settings", "plugins-lock.json");
    mkdirSync(bundledDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function createService(safeMode = false): PluginInventoryService {
    return new PluginInventoryService({ pluginsDir, lockfilePath, isSafeMode: () => safeMode });
  }

  async function zipBytes(id: string, version: string): Promise<Buffer> {
    const archive = new JSZip();
    archive.file("plugin.json", JSON.stringify({ schemaVersion: 1, id, name: id, version, frontend: { entryModule: "index.js" } }));
    archive.file("index.js", "export const pluginModule = {};");
    return archive.generateAsync({ type: "nodebuffer" });
  }

  /** Writes a bundle with these plugins; `corrupt` gives one a wrong sha256. */
  async function writeBundle(plugins: { id: string; version: string; corrupt?: boolean }[]): Promise<void> {
    const entries = [];
    for (const plugin of plugins) {
      const file = `${plugin.id}-${plugin.version}.zip`;
      const bytes = await zipBytes(plugin.id, plugin.version);
      writeFileSync(join(bundledDir, file), bytes);
      const sha256 = plugin.corrupt ? "0".repeat(64) : createHash("sha256").update(bytes).digest("hex");
      entries.push({ id: plugin.id, version: plugin.version, file, sha256 });
    }
    writeFileSync(join(bundledDir, BUNDLED_PLUGINS_LOCK_FILE), JSON.stringify({ schemaVersion: 1, plugins: entries }));
  }

  async function installZip(service: PluginInventoryService, id: string, version: string): Promise<void> {
    const path = join(root, `${id}-${version}-manual.zip`);
    writeFileSync(path, await zipBytes(id, version));
    expect((await service.installFromZip(path)).accepted).toBe(true);
  }

  async function versions(service: PluginInventoryService): Promise<Record<string, string>> {
    return Object.fromEntries((await service.getInventory()).plugins.map((plugin) => [plugin.id, plugin.version]));
  }

  it("installs missing plugins and upgrades older ones, as ordinary installs that need no restart", async () => {
    const service = createService();
    await service.initialize();
    await installZip(service, "com.example.old", "0.1.0");
    await service.initialize();
    await writeBundle([{ id: "com.example.new", version: "1.0.0" }, { id: "com.example.old", version: "0.2.0" }]);

    const outcomes = await service.installBundled(bundledDir);

    expect(outcomes).toEqual([
      { id: "com.example.new", version: "1.0.0", result: "installed" },
      { id: "com.example.old", version: "0.2.0", previousVersion: "0.1.0", result: "upgraded" }
    ]);
    expect(await versions(service)).toEqual({ "com.example.new": "1.0.0", "com.example.old": "0.2.0" });
    const inventory = await service.getInventory();
    expect(inventory.plugins.every((plugin) => plugin.restartRequired === false && plugin.status === "available")).toBe(true);
    expect(existsSync(join(pluginsDir, "com.example.new", "plugin.json"))).toBe(true);
  });

  it("keeps a disabled plugin disabled when it upgrades it", async () => {
    const service = createService();
    await service.initialize();
    await installZip(service, "com.example.one", "0.1.0");
    await service.setEnabled("com.example.one", false);
    await service.initialize();
    await writeBundle([{ id: "com.example.one", version: "0.2.0" }]);

    await service.installBundled(bundledDir);

    expect((await service.getInventory()).plugins).toEqual([expect.objectContaining({ id: "com.example.one", version: "0.2.0", enabled: false })]);
  });

  it("never downgrades, and doesn't bring back a plugin the user uninstalled", async () => {
    const service = createService();
    await service.initialize();
    await installZip(service, "com.example.newer", "2.0.0");
    await installZip(service, "com.example.removed", "0.1.0");
    await service.uninstall("com.example.removed");
    await service.initialize();
    await writeBundle([{ id: "com.example.newer", version: "1.0.0" }, { id: "com.example.removed", version: "0.2.0" }]);

    const outcomes = await service.installBundled(bundledDir);

    expect(outcomes.map((outcome) => outcome.result)).toEqual(["unchanged", "uninstalled-by-user"]);
    expect(await versions(service)).toEqual({ "com.example.newer": "2.0.0" });
  });

  it("installs a plugin again once the user installs it by hand after uninstalling it", async () => {
    const service = createService();
    await service.initialize();
    await installZip(service, "com.example.one", "0.1.0");
    await service.uninstall("com.example.one");
    await service.initialize();
    await installZip(service, "com.example.one", "0.1.0");
    await service.initialize();
    await writeBundle([{ id: "com.example.one", version: "0.2.0" }]);

    expect((await service.installBundled(bundledDir)).map((outcome) => outcome.result)).toEqual(["upgraded"]);
  });

  it("applies each bundled version once, and tries only a failed plugin again on the next start", async () => {
    const service = createService();
    await service.initialize();
    await writeBundle([{ id: "com.example.good", version: "1.0.0" }, { id: "com.example.bad", version: "1.0.0", corrupt: true }]);

    const first = await service.installBundled(bundledDir);
    expect(first).toEqual([
      { id: "com.example.good", version: "1.0.0", result: "installed" },
      { id: "com.example.bad", version: "1.0.0", result: "failed", reason: "com.example.bad-1.0.0.zip doesn't match its sha256 in bundled-plugins.lock.json" }
    ]);
    expect(await versions(service)).toEqual({ "com.example.good": "1.0.0" });

    await writeBundle([{ id: "com.example.good", version: "1.0.0" }, { id: "com.example.bad", version: "1.0.0" }]);
    expect(await service.installBundled(bundledDir)).toEqual([{ id: "com.example.bad", version: "1.0.0", result: "installed" }]);
    expect(await service.installBundled(bundledDir)).toEqual([]);
    expect(JSON.parse(readFileSync(lockfilePath, "utf8")).bundledApplied).toEqual({ "com.example.good": "1.0.0", "com.example.bad": "1.0.0" });
  });

  it("leaves a plugin the user downgraded after its bundled version was applied", async () => {
    const service = createService();
    await service.initialize();
    await writeBundle([{ id: "com.example.one", version: "0.2.0" }]);
    await service.installBundled(bundledDir);
    await installZip(service, "com.example.one", "0.1.0");
    await service.initialize();

    expect(await service.installBundled(bundledDir)).toEqual([]);
    expect(await versions(service)).toEqual({ "com.example.one": "0.1.0" });
  });

  it("refuses a ZIP that holds another plugin or version than the lock says, before installing anything", async () => {
    const service = createService();
    await service.initialize();
    await writeBundle([{ id: "com.example.one", version: "1.0.0" }]);
    // The lock's file now holds another plugin, with a matching sha256
    const bytes = await zipBytes("com.example.other", "1.0.0");
    writeFileSync(join(bundledDir, "com.example.one-1.0.0.zip"), bytes);
    writeFileSync(join(bundledDir, BUNDLED_PLUGINS_LOCK_FILE), JSON.stringify({
      schemaVersion: 1,
      plugins: [{ id: "com.example.one", version: "1.0.0", file: "com.example.one-1.0.0.zip", sha256: createHash("sha256").update(bytes).digest("hex") }]
    }));

    expect(await service.installBundled(bundledDir)).toEqual([
      { id: "com.example.one", version: "1.0.0", result: "failed", reason: "com.example.one-1.0.0.zip holds com.example.other 1.0.0, not com.example.one 1.0.0" }
    ]);
    expect(await versions(service)).toEqual({});
  });

  it("keeps going after a plugin whose ZIP is missing", async () => {
    const service = createService();
    await service.initialize();
    await writeBundle([{ id: "com.example.gone", version: "1.0.0" }, { id: "com.example.one", version: "1.0.0" }]);
    rmSync(join(bundledDir, "com.example.gone-1.0.0.zip"));

    const outcomes = await service.installBundled(bundledDir);

    expect(outcomes.map((outcome) => [outcome.id, outcome.result])).toEqual([["com.example.gone", "failed"], ["com.example.one", "installed"]]);
  });

  it("keeps a plugin installed again before the restart that would apply its uninstall, enabled", async () => {
    const service = createService();
    await service.initialize();
    await installZip(service, "com.example.one", "1.0.0");
    // The uninstall is pending, as when the plugin's files are in use
    const lock = JSON.parse(readFileSync(lockfilePath, "utf8"));
    lock.plugins[0].uninstallPending = true;
    lock.plugins[0].enabled = false;
    writeFileSync(lockfilePath, JSON.stringify(lock));

    await installZip(service, "com.example.one", "1.1.0");
    await service.initialize();

    expect((await service.getInventory()).plugins).toEqual([expect.objectContaining({ id: "com.example.one", version: "1.1.0", enabled: true, uninstallPending: false })]);
  });

  it("reinstalls a plugin whose files are gone, keeping it disabled", async () => {
    const service = createService();
    await service.initialize();
    await installZip(service, "com.example.one", "1.0.0");
    await service.setEnabled("com.example.one", false);
    rmSync(join(pluginsDir, "com.example.one"), { recursive: true, force: true });
    await service.initialize();
    await writeBundle([{ id: "com.example.one", version: "1.0.0" }]);

    expect((await service.installBundled(bundledDir)).map((outcome) => outcome.result)).toEqual(["installed"]);
    expect((await service.getInventory()).plugins).toEqual([expect.objectContaining({ id: "com.example.one", status: "available", enabled: false })]);
  });

  it("does nothing in safe mode, without a bundle, or with a bundle it can't read", async () => {
    await writeBundle([{ id: "com.example.one", version: "1.0.0" }]);
    const safe = createService(true);
    await safe.initialize();
    expect(await safe.installBundled(bundledDir)).toEqual([]);
    expect(await safe.installBundled(undefined)).toEqual([]);

    writeFileSync(join(bundledDir, BUNDLED_PLUGINS_LOCK_FILE), "{");
    const service = createService();
    await service.initialize();
    expect(await service.installBundled(bundledDir)).toEqual([expect.objectContaining({ id: BUNDLED_PLUGINS_LOCK_FILE, result: "failed" })]);
    expect(await versions(service)).toEqual({});
  });
});
