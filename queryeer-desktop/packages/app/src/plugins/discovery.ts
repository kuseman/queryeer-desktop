import type { ExternalPluginModule, PluginModule } from "@queryeer/api/plugin/PluginModule";
import type { ExternalPluginManifest, PluginManifest } from "@queryeer/api/plugin/PluginManifest";
import type { PluginManifestFile } from "@queryeer/api/plugin/PluginManifestFile";
import { validatePluginManifestFiles } from "./manifest-validation";

const internalEntries = Object.entries(
  import.meta.glob("./*/module.ts", { eager: true }) as Record<string, { pluginModule: PluginModule }>
);

const internalManifests: PluginManifestFile[] = internalEntries.map(([key, { pluginModule }]) => ({
  ...pluginModule.manifest,
  modulePath: key.replace(/\.ts$/, "")
}));

const internalModules: PluginModule[] = internalEntries.map(([, { pluginModule }]) => pluginModule);

export type PluginDiscoveryResult = {
  manifests: PluginManifestFile[];
  modules: PluginModule[];
  loadErrors: {
    pluginId: string;
    modulePath: string;
    message: string;
  }[];
};

export async function discoverPluginModules(
  externalManifests: PluginManifestFile[] = []
): Promise<PluginDiscoveryResult> {
  const { manifests, loadErrors } = mergeManifests(internalManifests, externalManifests);
  validatePluginManifestFiles(manifests);

  const modules = [...internalModules];
  const internalIds = new Set(internalManifests.map((m) => m.id));

  for (const manifest of manifests) {
    if (internalIds.has(manifest.id)) {
      continue;
    }
    try {
      const loaded = await createExternalLoader(manifest.modulePath)();
      const resolved = resolveExternalManifest(manifest, loaded.pluginModule.manifest);
      const plugin = Object.assign(loaded.pluginModule.plugin, { manifest: resolved });
      modules.push({ manifest: resolved, plugin });
    } catch (error) {
      loadErrors.push({
        pluginId: manifest.id,
        modulePath: manifest.modulePath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { manifests, modules, loadErrors };
}

function mergeManifests(
  internalManifests: PluginManifestFile[],
  externalManifests: PluginManifestFile[]
): {
  manifests: PluginManifestFile[];
  loadErrors: { pluginId: string; modulePath: string; message: string }[];
} {
  const manifests = [...internalManifests];
  const loadErrors: { pluginId: string; modulePath: string; message: string }[] = [];
  const ids = new Set(manifests.map((m) => m.id));

  for (const external of externalManifests) {
    if (ids.has(external.id)) {
      loadErrors.push({
        pluginId: external.id,
        modulePath: external.modulePath,
        message: `Duplicate plugin id '${external.id}' ignored from external source`
      });
      continue;
    }
    manifests.push(external);
    ids.add(external.id);
  }

  return { manifests, loadErrors };
}

const IDENTITY_FIELDS = ["id", "name", "version", "description"] as const;

/**
 * The frontend manifest with the identity from `plugin.json`, the only place it is declared. A plugin built for 0.19
 * still sets these fields in its frontend manifest; they are ignored, with a warning when they differ.
 */
export function resolveExternalManifest(
  fromPluginJson: PluginManifestFile,
  fromModule: ExternalPluginManifest | undefined
): PluginManifest {
  if (!fromModule || typeof fromModule !== "object") {
    throw new Error(`Plugin ${fromPluginJson.id}: the frontend module's pluginModule has no manifest`);
  }
  const { id, name, version, description, ...rest } = fromModule as ExternalPluginManifest & Partial<PluginManifest>;
  const declared = { id, name, version, description };
  const ignored = IDENTITY_FIELDS.filter(
    (field) => declared[field] !== undefined && declared[field] !== fromPluginJson[field]
  );
  if (ignored.length > 0) {
    console.warn(
      `[plugins] ${fromPluginJson.id}: ignoring ${ignored.join(", ")} in the frontend manifest; plugin.json declares them`
    );
  }
  return {
    ...rest,
    id: fromPluginJson.id,
    name: fromPluginJson.name,
    version: fromPluginJson.version,
    ...(fromPluginJson.description !== undefined ? { description: fromPluginJson.description } : {})
  };
}

function createExternalLoader(modulePath: string): () => Promise<{ pluginModule: ExternalPluginModule }> {
  return async () => {
    const normalizedPath = modulePath.replace(/\\/g, "/");
    const moduleUrl = resolveExternalModuleUrl(normalizedPath);
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as {
      pluginModule?: ExternalPluginModule;
    };

    if (!loaded.pluginModule) {
      throw new Error(`External plugin module '${modulePath}' does not export pluginModule`);
    }

    return { pluginModule: loaded.pluginModule };
  };
}

function resolveExternalModuleUrl(normalizedPath: string): string {
  const hasWindow = typeof window !== "undefined";
  const isDevServer = hasWindow && /^https?:$/.test(window.location.protocol);

  if (isDevServer) {
    const fsPath = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
    return `${window.location.origin}/@fs${fsPath}`;
  }

  return normalizedPath.startsWith("/")
    ? `file://${normalizedPath}`
    : `file:///${normalizedPath}`;
}
