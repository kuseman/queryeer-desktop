import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { discoverExternalFrontendPlugins } from "./frontend-plugin-discovery.js";

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "queryeer-frontend-discovery-test-"));
  tempRoots.push(root);
  return root;
}

function writeFolderPlugin(root: string, folderName: string, manifest: object, moduleFile = "frontend/module.mjs"): string {
  const pluginDir = join(root, folderName);
  mkdirSync(join(pluginDir, "frontend"), { recursive: true });
  writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(pluginDir, moduleFile), "export const pluginModule = {};\n");
  return pluginDir;
}

async function writeZipPlugin(root: string, fileName: string, manifest: object, moduleFile = "frontend/module.mjs"): Promise<string> {
  const zipPath = join(root, fileName);
  const archive = new JSZip();
  archive.file("plugin.json", JSON.stringify(manifest, null, 2));
  archive.file(moduleFile, "export const pluginModule = {};\n");
  const zipBuffer = await archive.generateAsync({ type: "nodebuffer" });
  writeFileSync(zipPath, zipBuffer);
  return zipPath;
}

async function writeZipEntries(
  root: string,
  fileName: string,
  entries: Record<string, string>
): Promise<string> {
  const zipPath = join(root, fileName);
  const archive = new JSZip();
  for (const [entryPath, entryContent] of Object.entries(entries)) {
    archive.file(entryPath, entryContent);
  }
  const zipBuffer = await archive.generateAsync({ type: "nodebuffer" });
  writeFileSync(zipPath, zipBuffer);
  return zipPath;
}

describe("discoverExternalFrontendPlugins", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0, tempRoots.length)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns no plugins when managed plugin directory is missing", async () => {
    const root = resolve(createTempRoot(), "missing");

    const discovered = await discoverExternalFrontendPlugins(root);

    expect(discovered).toEqual([]);
  });

  it("discovers frontend plugin from folder source", async () => {
    const root = createTempRoot();

    const pluginDir = writeFolderPlugin(root, "folder-plugin", {
      schemaVersion: 1,
      id: "folder.plugin",
      name: "Folder Plugin",
      version: "1.0.0",
      frontend: { entryModule: "frontend/module.mjs" }
    });

    const discovered = await discoverExternalFrontendPlugins(root);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]).toMatchObject({
      id: "folder.plugin",
      sourcePath: pluginDir,
      modulePath: resolve(pluginDir, "frontend/module.mjs")
    });
  });

  it("discovers frontend plugin from zip source", async () => {
    const root = createTempRoot();

    const zipPath = await writeZipPlugin(root, "zip-plugin.zip", {
      schemaVersion: 1,
      id: "zip.plugin",
      name: "Zip Plugin",
      version: "2.0.0",
      frontend: { entryModule: "frontend/module.mjs" }
    });

    const discovered = await discoverExternalFrontendPlugins(root);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.sourcePath).toBe(zipPath);
    expect(discovered[0]?.modulePath.replace(/\\/g, "/").endsWith("frontend/module.mjs")).toBe(true);
    const moduleContent = readFileSync(discovered[0].modulePath, "utf8");
    expect(moduleContent).toContain("pluginModule");
  });

  it("prefers first plugin for duplicate id across sources", async () => {
    const root = createTempRoot();

    writeFolderPlugin(root, "00-folder-plugin", {
      schemaVersion: 1,
      id: "duplicate.plugin",
      name: "Folder First",
      version: "1.0.0",
      frontend: { entryModule: "frontend/module.mjs" }
    });

    await writeZipPlugin(root, "10-zip-plugin.zip", {
      schemaVersion: 1,
      id: "duplicate.plugin",
      name: "Zip Second",
      version: "2.0.0",
      frontend: { entryModule: "frontend/module.mjs" }
    });

    const discovered = await discoverExternalFrontendPlugins(root);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.name).toBe("Folder First");
  });

  it("ignores zip plugin without root manifest", async () => {
    const root = createTempRoot();

    await writeZipEntries(root, "nested-manifest.zip", {
      "nested/plugin.json": JSON.stringify({
        schemaVersion: 1,
        id: "nested.plugin",
        name: "Nested Plugin",
        version: "1.0.0",
        frontend: { entryModule: "frontend/module.mjs" }
      }),
      "nested/frontend/module.mjs": "export const pluginModule = {};\n"
    });

    const discovered = await discoverExternalFrontendPlugins(root);
    expect(discovered).toHaveLength(0);
  });

  it("ignores zip plugin with invalid manifest shape", async () => {
    const root = createTempRoot();

    await writeZipEntries(root, "invalid-manifest.zip", {
      "plugin.json": JSON.stringify({
        schemaVersion: 1,
        id: "invalid.plugin",
        name: "Invalid Plugin",
        version: "1.0.0",
        frontend: {}
      }),
      "frontend/module.mjs": "export const pluginModule = {};\n"
    });

    const discovered = await discoverExternalFrontendPlugins(root);
    expect(discovered).toHaveLength(0);
  });

  it("ignores zip plugin whose frontend entry escapes extraction root", async () => {
    const root = createTempRoot();

    await writeZipEntries(root, "escape-entry.zip", {
      "plugin.json": JSON.stringify({
        schemaVersion: 1,
        id: "escape.plugin",
        name: "Escape Plugin",
        version: "1.0.0",
        frontend: { entryModule: "../outside/module.mjs" }
      }),
      "outside/module.mjs": "export const pluginModule = {};\n"
    });

    const discovered = await discoverExternalFrontendPlugins(root);
    expect(discovered).toHaveLength(0);
  });
});
