import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toPluginManifestFile, type PluginManifestFile } from "@queryeer/api/plugin/PluginManifestFile";
import type { ExternalPluginManifest } from "@queryeer/api/plugin/PluginManifest";
import { discoverPluginModules, resolveExternalManifest } from "../../plugins/discovery";

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

  describe("identity from plugin.json (F11)", () => {
    const fromPluginJson = {
      ...externalManifest("external.plugin", "/plugins/external/index.js"),
      version: "2.3.4",
      description: "From plugin.json"
    };

    it("takes id, name, version and description from plugin.json", () => {
      expect(resolveExternalManifest(fromPluginJson, { kind: "feature", dependencies: ["core.layout"] })).toEqual({
        id: "external.plugin",
        name: "external.plugin",
        version: "2.3.4",
        description: "From plugin.json",
        kind: "feature",
        dependencies: ["core.layout"]
      });
    });

    it("ignores identity a plugin built for 0.19 still sets, and warns when it differs", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      // A 0.19 build: the frontend manifest repeats the identity, with another name and description
      const built019 = {
        id: "external.plugin",
        name: "Longer Name",
        version: "2.3.4",
        description: "From the module",
        kind: "feature"
      } as ExternalPluginManifest;

      expect(resolveExternalManifest(fromPluginJson, built019)).toEqual({
        id: "external.plugin",
        name: "external.plugin",
        version: "2.3.4",
        description: "From plugin.json",
        kind: "feature"
      });
      expect(warn).toHaveBeenCalledWith(
        "[plugins] external.plugin: ignoring name, description in the frontend manifest; plugin.json declares them"
      );
      warn.mockRestore();
    });

    it("doesn't warn when repeated identity matches plugin.json", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const matching = { id: "external.plugin", name: "external.plugin", version: "2.3.4", kind: "feature" } as ExternalPluginManifest;
      resolveExternalManifest(fromPluginJson, matching);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it("toPluginManifestFile carries plugin.json's description", () => {
      const base = { id: "a", name: "A", version: "1.0.0", modulePath: "/a.js", sourcePath: "/a" };
      expect(toPluginManifestFile({ ...base, description: "Text" }).description).toBe("Text");
      expect(toPluginManifestFile(base)).not.toHaveProperty("description");
    });

    it("leaves description out when plugin.json has none", () => {
      const { description: _ignored, ...withoutDescription } = fromPluginJson;
      expect(resolveExternalManifest(withoutDescription, { kind: "feature" })).not.toHaveProperty("description");
    });

    it("refuses a module without a manifest", () => {
      expect(() => resolveExternalManifest(fromPluginJson, undefined)).toThrow("has no manifest");
    });
  });
});
