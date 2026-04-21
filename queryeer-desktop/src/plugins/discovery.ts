import type { PluginModule } from "../contracts/plugin/PluginModule";
import type { PluginManifestFile } from "../contracts/plugin/PluginManifestFile";
import { loadPluginManifests } from "./manifest-loader";
import { validatePluginManifestFiles } from "./manifest-validation";

type PluginLoader = () => Promise<{ pluginModule: PluginModule }>;

const moduleLoaders: Partial<Record<string, PluginLoader>> = {
  "./core.layout/module": async () => import("./core.layout/module"),
  "./core.filesystem/module": async () => import("./core.filesystem/module"),
  "./core.files/module": async () => import("./core.files/module"),
  "./core.commands/module": async () => import("./core.commands/module")
};

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
  const mergeResult = mergeManifests(loadPluginManifests(), externalManifests);
  const manifests = mergeResult.manifests;
  validatePluginManifestFiles(manifests);

  const modules = await loadModulesFromManifests(manifests);
  return {
    manifests,
    modules: modules.modules,
    loadErrors: [...mergeResult.loadErrors, ...modules.loadErrors]
  };
}

function mergeManifests(
  internalManifests: PluginManifestFile[],
  externalManifests: PluginManifestFile[]
): {
  manifests: PluginManifestFile[];
  loadErrors: {
    pluginId: string;
    modulePath: string;
    message: string;
  }[];
} {
  const manifests = [...internalManifests];
  const loadErrors: {
    pluginId: string;
    modulePath: string;
    message: string;
  }[] = [];
  const ids = new Set(manifests.map((manifest) => manifest.id));

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

  return {
    manifests,
    loadErrors
  };
}

async function loadModulesFromManifests(
  manifests: PluginManifestFile[]
): Promise<{
  modules: PluginModule[];
  loadErrors: {
    pluginId: string;
    modulePath: string;
    message: string;
  }[];
}> {
  const modules: PluginModule[] = [];
  const loadErrors: {
    pluginId: string;
    modulePath: string;
    message: string;
  }[] = [];

  for (const manifest of manifests) {
    const loader = moduleLoaders[manifest.modulePath];
    const dynamicLoader = loader ?? createExternalLoader(manifest.modulePath);

    try {
      const loaded = await dynamicLoader();
      if (loaded.pluginModule.manifest.id !== manifest.id) {
        throw new Error(
          `Plugin id mismatch for '${manifest.modulePath}', expected '${manifest.id}'`
        );
      }

      loaded.pluginModule.plugin.manifest = loaded.pluginModule.manifest;
      modules.push(loaded.pluginModule);
    } catch (error) {
      if (loader) {
        throw error;
      }
      loadErrors.push({
        pluginId: manifest.id,
        modulePath: manifest.modulePath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    modules,
    loadErrors
  };
}

function createExternalLoader(modulePath: string): PluginLoader {
  return async () => {
    const normalizedPath = modulePath.replace(/\\/g, "/");
    const moduleUrl = resolveExternalModuleUrl(normalizedPath);
    const loaded = (await import(/* @vite-ignore */ moduleUrl)) as {
      pluginModule?: PluginModule;
    };

    if (!loaded.pluginModule) {
      throw new Error(`External plugin module '${modulePath}' does not export pluginModule`);
    }

    return {
      pluginModule: loaded.pluginModule
    };
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
