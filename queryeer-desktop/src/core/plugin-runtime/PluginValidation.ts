import type { Plugin } from "../../contracts/plugin/Plugin";

export function validateDependencies(plugins: Plugin[]): void {
  const ids = new Set(plugins.map((plugin) => plugin.manifest.id));

  for (const plugin of plugins) {
    const dependencies = plugin.manifest.dependencies ?? [];
    for (const dependencyId of dependencies) {
      if (!ids.has(dependencyId)) {
        throw new Error(
          `Plugin '${plugin.manifest.id}' has missing dependency '${dependencyId}'`
        );
      }
    }
  }
}

export function validateRequiredCapabilities(plugins: Plugin[]): void {
  const providedCapabilities = new Set<string>();

  for (const plugin of plugins) {
    for (const capability of plugin.manifest.providesCapabilities ?? []) {
      providedCapabilities.add(capability);
    }
  }

  for (const plugin of plugins) {
    for (const requiredCapability of plugin.manifest.requiredCapabilities ?? []) {
      if (!providedCapabilities.has(requiredCapability)) {
        throw new Error(
          `Plugin '${plugin.manifest.id}' requires missing capability '${requiredCapability}'`
        );
      }
    }
  }
}

export function orderPluginsByDependencies(plugins: Plugin[]): Plugin[] {
  const pluginById = new Map<string, Plugin>();
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const plugin of plugins) {
    pluginById.set(plugin.manifest.id, plugin);
    inDegree.set(plugin.manifest.id, 0);
    dependents.set(plugin.manifest.id, []);
  }

  for (const plugin of plugins) {
    const dependencies = plugin.manifest.dependencies ?? [];
    for (const dependencyId of dependencies) {
      inDegree.set(plugin.manifest.id, (inDegree.get(plugin.manifest.id) ?? 0) + 1);
      dependents.get(dependencyId)?.push(plugin.manifest.id);
    }
  }

  const queue: string[] = [];
  for (const [pluginId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(pluginId);
    }
  }

  const ordered: Plugin[] = [];
  while (queue.length > 0) {
    const pluginId = queue.shift();
    if (!pluginId) {
      break;
    }

    const plugin = pluginById.get(pluginId);
    if (plugin) {
      ordered.push(plugin);
    }

    for (const dependentId of dependents.get(pluginId) ?? []) {
      const nextDegree = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, nextDegree);
      if (nextDegree === 0) {
        queue.push(dependentId);
      }
    }
  }

  if (ordered.length !== plugins.length) {
    throw new Error("Plugin dependency cycle detected");
  }

  return ordered;
}
