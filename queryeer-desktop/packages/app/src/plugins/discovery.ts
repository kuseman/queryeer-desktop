import type { PluginModule } from "@queryeer/api/plugin/PluginModule";
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
      if (loaded.pluginModule.manifest.id !== manifest.id) {
        throw new Error(
          `Plugin id mismatch for '${manifest.modulePath}', expected '${manifest.id}'`
        );
      }
      loaded.pluginModule.plugin.manifest = loaded.pluginModule.manifest;
      modules.push(loaded.pluginModule);
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

function createExternalLoader(modulePath: string): () => Promise<{ pluginModule: PluginModule }> {
  return async () => {
    const normalizedPath = modulePath.replace(/\\/g, "/");
    const moduleUrl = resolveExternalModuleUrl(normalizedPath);
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as {
      pluginModule?: PluginModule;
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
