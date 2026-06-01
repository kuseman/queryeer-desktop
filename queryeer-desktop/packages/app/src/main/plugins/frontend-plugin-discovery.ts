import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import JSZip from "jszip";
import type { ExternalFrontendPluginManifest } from "@queryeer/api/plugin/ExternalFrontendPluginManifest.js";

type PluginManifestV1 = {
  schemaVersion?: number;
  id?: string;
  name?: string;
  version?: string;
  frontend?: {
    entryModule?: string;
  };
};

const MANIFEST_FILE = "plugin.json";
const ZIP_EXTENSION = ".zip";
const EXTRACTION_ROOT = resolve(tmpdir(), "queryeer-desktop-frontend-plugins");

export async function discoverExternalFrontendPlugins(root: string): Promise<ExternalFrontendPluginManifest[]> {
  if (!root || !existsSync(root)) {
    return [];
  }

  const entries = readdirSync(root)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => join(root, name));
  const manifests: ExternalFrontendPluginManifest[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries) {
    try {
      const stats = statSync(entry);
      let manifest: ExternalFrontendPluginManifest | null = null;

      if (stats.isDirectory()) {
        manifest = loadFromFolder(entry);
      } else if (stats.isFile() && entry.toLowerCase().endsWith(ZIP_EXTENSION)) {
        manifest = await loadFromZip(entry);
      }

      if (!manifest) {
        continue;
      }

      if (seenIds.has(manifest.id)) {
        continue;
      }

      if (!existsSync(manifest.modulePath)) {
        continue;
      }

      seenIds.add(manifest.id);
      manifests.push(manifest);
    } catch {
      // ignore invalid plugin entries
    }
  }

  return manifests;
}

function loadFromFolder(folderPath: string): ExternalFrontendPluginManifest | null {
  const manifestPath = join(folderPath, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as PluginManifestV1;
  if (!isValidManifest(parsed)) {
    return null;
  }

  const entryModule = parsed.frontend?.entryModule;
  if (typeof entryModule !== "string" || entryModule.length === 0) {
    return null;
  }

  const modulePath = resolve(folderPath, entryModule);
  if (!isWithinRoot(modulePath, folderPath)) {
    return null;
  }

  return {
    id: parsed.id,
    name: parsed.name,
    version: parsed.version,
    modulePath,
    sourcePath: folderPath
  };
}

async function loadFromZip(zipPath: string): Promise<ExternalFrontendPluginManifest | null> {
  const extractionDir = resolve(
    EXTRACTION_ROOT,
    `${sanitizePathSegment(basename(zipPath))}-${String(statSync(zipPath).mtimeMs)}`
  );

  const archive = await JSZip.loadAsync(readFileSync(zipPath));
  await extractZipArchive(archive, extractionDir);

  const manifestPath = join(extractionDir, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return null;
  }

  const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as PluginManifestV1;
  if (!isValidManifest(parsed)) {
    return null;
  }

  const entryModule = parsed.frontend?.entryModule;
  if (typeof entryModule !== "string" || entryModule.length === 0) {
    return null;
  }

  const modulePath = resolve(extractionDir, entryModule);
  if (!isWithinRoot(modulePath, extractionDir)) {
    return null;
  }

  return {
    id: parsed.id,
    name: parsed.name,
    version: parsed.version,
    modulePath,
    sourcePath: zipPath
  };
}

async function extractZipArchive(archive: JSZip, targetRoot: string): Promise<void> {
  await mkdir(targetRoot, { recursive: true });

  const entries = Object.keys(archive.files).sort((a, b) => a.localeCompare(b));
  for (const entryName of entries) {
    const zipEntry = archive.files[entryName];
    const destination = resolve(targetRoot, entryName);
    if (!isWithinRoot(destination, targetRoot)) {
      continue;
    }

    if (zipEntry.dir) {
      await mkdir(destination, { recursive: true });
      continue;
    }

    const parent = resolve(destination, "..");
    if (!isWithinRoot(parent, targetRoot)) {
      continue;
    }

    await mkdir(parent, { recursive: true });
    const content = await zipEntry.async("nodebuffer");
    await writeFile(destination, content);
  }
}

function isValidManifest(parsed: PluginManifestV1): parsed is Required<Pick<PluginManifestV1, "schemaVersion" | "id" | "name" | "version" | "frontend">> {
  return (
    parsed.schemaVersion === 1 &&
    typeof parsed.id === "string" &&
    parsed.id.length > 0 &&
    typeof parsed.name === "string" &&
    parsed.name.length > 0 &&
    typeof parsed.version === "string" &&
    parsed.version.length > 0 &&
    typeof parsed.frontend?.entryModule === "string" &&
    parsed.frontend.entryModule.length > 0
  );
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isWithinRoot(candidate: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}
