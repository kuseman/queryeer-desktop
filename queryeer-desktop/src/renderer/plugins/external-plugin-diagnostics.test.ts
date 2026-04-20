import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginManifestFile } from "../../contracts/plugin/PluginManifestFile";
import { discoverPluginModules } from "../../plugins/discovery";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "queryeer-external-plugin-test-"));
  tempRoots.push(root);
  return root;
}

function externalManifest(id: string, modulePath: string): PluginManifestFile {
  return {
    id,
    name: id,
    version: "1.0.0",
    kind: "feature",
    modulePath
  };
}

describe("discoverPluginModules external diagnostics", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("records load error for missing external module path", async () => {
    const root = createTempRoot();
    const missingPath = resolve(root, "missing-plugin.mjs");

    const result = await discoverPluginModules([
      externalManifest("external.missing.module", missingPath)
    ]);

    expect(result.loadErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginId: "external.missing.module",
          modulePath: missingPath
        })
      ])
    );
  });

  it("records load error when external module lacks pluginModule export", async () => {
    const root = createTempRoot();
    const invalidModulePath = resolve(root, "invalid-plugin.mjs");
    writeFileSync(invalidModulePath, "export const somethingElse = 1;\n");

    const result = await discoverPluginModules([
      externalManifest("external.invalid.export", invalidModulePath)
    ]);

    const matchingError = result.loadErrors.find(
      (error) =>
        error.pluginId === "external.invalid.export" &&
        error.modulePath === invalidModulePath
    );

    expect(matchingError).toBeDefined();
    expect(matchingError?.message.length).toBeGreaterThan(0);
  });

  it("records diagnostic when external manifest id duplicates internal plugin", async () => {
    const root = createTempRoot();
    const duplicateModulePath = resolve(root, "duplicate-plugin.mjs");
    writeFileSync(duplicateModulePath, "export const pluginModule = {};\n");

    const result = await discoverPluginModules([
      externalManifest("core.layout", duplicateModulePath)
    ]);

    expect(result.loadErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pluginId: "core.layout",
          modulePath: duplicateModulePath,
          message: expect.stringContaining("Duplicate plugin id 'core.layout'")
        })
      ])
    );
  });
});
