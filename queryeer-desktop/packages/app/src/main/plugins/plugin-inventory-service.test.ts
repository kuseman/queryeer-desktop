import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PluginInventoryService } from "./plugin-inventory-service.js";

let root: string;
let pluginsDir: string;
let lockfilePath: string;

function writeFolderPlugin(folderName: string, manifest: object): string {
  const pluginDir = join(pluginsDir, folderName);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify(manifest, null, 2), "utf8");
  return pluginDir;
}

function createService(safeMode = false): PluginInventoryService {
  return new PluginInventoryService({
    pluginsDir,
    lockfilePath,
    isSafeMode: () => safeMode
  });
}

describe("PluginInventoryService", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "queryeer-plugin-inventory-"));
    pluginsDir = join(root, "plugins");
    lockfilePath = join(root, "settings", "plugins-lock.json");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates a lockfile with newly discovered managed plugins enabled", async () => {
    const pluginDir = writeFolderPlugin("external-one", {
      schemaVersion: 1,
      id: "external.one",
      name: "External One",
      version: "1.0.0",
      frontend: { entryModule: "frontend/module.mjs" }
    });

    const service = createService();
    await service.initialize();

    const inventory = await service.getInventory();
    expect(inventory.plugins).toEqual([
      expect.objectContaining({
        id: "external.one",
        name: "External One",
        enabled: true,
        sourcePath: pluginDir,
        status: "available",
        hasFrontend: true,
        hasBackend: false,
        restartRequired: false
      })
    ]);
    expect(JSON.parse(readFileSync(lockfilePath, "utf8"))).toMatchObject({
      version: 1,
      plugins: [expect.objectContaining({ id: "external.one", enabled: true })]
    });
  });

  it("persists disabled plugin ids and clears restartRequired on next initialization", async () => {
    writeFolderPlugin("external-one", {
      schemaVersion: 1,
      id: "external.one",
      name: "External One",
      version: "1.0.0",
      backend: { entrypointClass: "com.example.ExternalOne" }
    });

    const service = createService();
    await service.initialize();

    const result = await service.setEnabled("external.one", false);

    expect(result).toMatchObject({ accepted: true, restartRequired: true });
    expect(service.getDisabledPluginIds()).toEqual(["external.one"]);
    expect((await service.getInventory()).plugins[0]).toMatchObject({
      id: "external.one",
      enabled: false,
      restartRequired: true
    });

    const restarted = createService();
    await restarted.initialize();

    expect(restarted.getDisabledPluginIds()).toEqual(["external.one"]);
    expect((await restarted.getInventory()).plugins[0]).toMatchObject({
      id: "external.one",
      enabled: false,
      restartRequired: false
    });
  });

  it("reports duplicate managed plugin ids as invalid", async () => {
    const manifest = {
      schemaVersion: 1,
      id: "external.duplicate",
      name: "External Duplicate",
      version: "1.0.0",
      frontend: { entryModule: "frontend/module.mjs" }
    };
    writeFolderPlugin("00-first", manifest);
    writeFolderPlugin("10-second", manifest);

    const service = createService();
    await service.initialize();

    expect((await service.getInventory()).plugins).toEqual([
      expect.objectContaining({
        id: "external.duplicate",
        status: "invalid",
        lastError: "Duplicate plugin id discovered in managed plugins directory"
      })
    ]);
  });

  it("keeps missing lockfile entries visible but unavailable", async () => {
    mkdirSync(pluginsDir, { recursive: true });
    mkdirSync(dirname(lockfilePath), { recursive: true });
    writeFileSync(
      lockfilePath,
      JSON.stringify({
        version: 1,
        plugins: [
          {
            id: "external.missing",
            name: "External Missing",
            version: "1.0.0",
            enabled: true,
            source: { type: "folder", path: join(pluginsDir, "missing") }
          }
        ]
      }),
      "utf8"
    );

    const service = createService(true);
    await service.initialize();

    expect(await service.getInventory()).toMatchObject({
      safeMode: true,
      plugins: [
        expect.objectContaining({
          id: "external.missing",
          status: "missing",
          hasFrontend: false,
          hasBackend: false,
          lastError: "Plugin source is no longer present"
        })
      ]
    });
  });
});
