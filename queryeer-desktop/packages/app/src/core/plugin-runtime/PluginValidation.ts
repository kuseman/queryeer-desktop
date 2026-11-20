import type { Plugin } from "@queryeer/api/plugin/Plugin";
import type { PluginManifest } from "@queryeer/api/plugin/PluginManifest";

export type NormalizedDependency = { id: string; optional: boolean };

/** A manifest's dependencies as `{ id, optional }`; throws on an entry that is neither an id nor `{ id }`. */
export function dependencyEntries(manifest: Pick<PluginManifest, "id" | "dependencies">): NormalizedDependency[] {
  const entries: NormalizedDependency[] = [];
  const declared: unknown = manifest.dependencies ?? [];
  if (!Array.isArray(declared)) {
    throw new Error(`Plugin '${manifest.id}' has invalid dependencies: expected a list`);
  }
  for (const entry of declared as unknown[]) {
    if (typeof entry === "string" && entry.trim() !== "") {
      entries.push({ id: entry, optional: false });
    } else if (
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as { id?: unknown }).id === "string" &&
      (entry as { id: string }).id.trim() !== "" &&
      ["undefined", "boolean"].includes(typeof (entry as { optional?: unknown }).optional)
    ) {
      entries.push({ id: (entry as { id: string }).id, optional: (entry as { optional?: unknown }).optional === true });
    } else {
      throw new Error(`Plugin '${manifest.id}' has an invalid dependency entry: ${JSON.stringify(entry)}`);
    }
  }
  return entries;
}

/** A manifest's capability list (`providesCapabilities` or `requiredCapabilities`); throws unless it is a list of names. */
export function capabilityList(
  manifest: Pick<PluginManifest, "id" | "providesCapabilities" | "requiredCapabilities">,
  field: "providesCapabilities" | "requiredCapabilities"
): string[] {
  const declared: unknown = manifest[field] ?? [];
  if (!Array.isArray(declared) || !declared.every((entry) => typeof entry === "string" && entry.trim() !== "")) {
    throw new Error(`Plugin '${manifest.id}' has invalid ${field}: expected a list of capability names`);
  }
  return declared as string[];
}

export type PluginActivationPlan = {
  /** The plugins to activate, each after the plugins it depends on (required, and optional ones in use). */
  order: Plugin[];
  /** Plugins left out, with the reason, by id. */
  skipped: Map<string, string>;
  /** Per plugin: its required dependencies and the optional ones in use, for `isDependencyActive`. */
  dependencies: Map<string, Set<string>>;
  /** Per plugin: its required dependencies only; one that fails to activate skips the plugin. */
  requiredDependencies: Map<string, string[]>;
  /** Problems that didn't stop a plugin, by id. */
  warnings: Map<string, string[]>;
  /** Per plugin: its validated capabilities. */
  capabilities: Map<string, { provides: string[]; requires: string[] }>;
};

/**
 * Which plugins to activate, and in which order. Never throws: a plugin with a missing, invalid or skipped required
 * dependency, a required dependency cycle, or a required capability no remaining plugin provides is skipped with a
 * reason. An optional dependency is used when it is there and not skipped, unless it would close a dependency cycle.
 */
export function planActivation(plugins: Plugin[]): PluginActivationPlan {
  const skipped = new Map<string, string>();
  const warnings = new Map<string, string[]>();
  const warn = (pluginId: string, message: string) => {
    warnings.set(pluginId, [...(warnings.get(pluginId) ?? []), message]);
  };
  const ids = new Set(plugins.map((plugin) => plugin.manifest.id));
  const declared = new Map<string, NormalizedDependency[]>();
  const capabilities = new Map<string, { provides: string[]; requires: string[] }>();

  // An external plugin's frontend manifest isn't validated before this: a bad field skips only that plugin
  for (const plugin of plugins) {
    const pluginId = plugin.manifest.id;
    try {
      declared.set(pluginId, dependencyEntries(plugin.manifest));
      capabilities.set(pluginId, {
        provides: capabilityList(plugin.manifest, "providesCapabilities"),
        requires: capabilityList(plugin.manifest, "requiredCapabilities")
      });
    } catch (error) {
      declared.set(pluginId, []);
      capabilities.set(pluginId, { provides: [], requires: [] });
      skipped.set(pluginId, error instanceof Error ? error.message : String(error));
    }
  }
  const required = (pluginId: string) =>
    (declared.get(pluginId) ?? []).filter((dependency) => !dependency.optional).map((dependency) => dependency.id);
  const optional = (pluginId: string) =>
    (declared.get(pluginId) ?? []).filter((dependency) => dependency.optional).map((dependency) => dependency.id);

  for (const plugin of plugins) {
    const pluginId = plugin.manifest.id;
    const missing = required(pluginId).find((dependencyId) => !ids.has(dependencyId));
    if (!skipped.has(pluginId) && missing !== undefined) {
      skipped.set(pluginId, `Missing dependency: ${missing}`);
    }
  }

  // A cycle of required dependencies skips its plugins
  const requiredEdges = (pluginId: string) => required(pluginId).filter((dependencyId) => ids.has(dependencyId));
  for (const component of stronglyConnectedComponents([...ids], requiredEdges)) {
    const cyclic = component.length > 1 || requiredEdges(component[0]).includes(component[0]);
    if (cyclic) {
      for (const pluginId of component) {
        if (!skipped.has(pluginId)) {
          skipped.set(pluginId, `Dependency cycle: ${component.join(", ")}`);
        }
      }
    }
  }

  // Skipping one plugin can skip the plugins that need it, or what it provides
  for (let changed = true; changed; ) {
    changed = false;
    const provided = new Set<string>();
    for (const plugin of plugins) {
      if (!skipped.has(plugin.manifest.id)) {
        for (const capability of capabilities.get(plugin.manifest.id)?.provides ?? []) {
          provided.add(capability);
        }
      }
    }
    for (const plugin of plugins) {
      const pluginId = plugin.manifest.id;
      if (skipped.has(pluginId)) {
        continue;
      }
      const skippedDependency = required(pluginId).find((dependencyId) => skipped.has(dependencyId));
      const missingCapability = (capabilities.get(pluginId)?.requires ?? []).find((capability) => !provided.has(capability));
      if (skippedDependency !== undefined) {
        skipped.set(pluginId, `Dependency ${skippedDependency} was skipped`);
        changed = true;
      } else if (missingCapability !== undefined) {
        skipped.set(pluginId, `Requires missing capability '${missingCapability}'`);
        changed = true;
      }
    }
  }

  const remaining = plugins.filter((plugin) => !skipped.has(plugin.manifest.id));
  const remainingIds = remaining.map((plugin) => plugin.manifest.id);
  const usable = (pluginId: string) => [
    ...required(pluginId),
    ...optional(pluginId).filter((dependencyId) => ids.has(dependencyId) && !skipped.has(dependencyId))
  ];
  // An optional dependency inside a cycle (or on the plugin itself) is not used; the other edges are kept
  const componentOf = new Map<string, number>();
  stronglyConnectedComponents(remainingIds, usable).forEach((component, index) => {
    for (const pluginId of component) {
      componentOf.set(pluginId, index);
    }
  });
  const dependencies = new Map<string, Set<string>>();
  const requiredDependencies = new Map<string, string[]>();
  for (const pluginId of remainingIds) {
    const inUse = new Set(required(pluginId));
    for (const dependencyId of optional(pluginId)) {
      if (!ids.has(dependencyId) || skipped.has(dependencyId)) {
        continue;
      }
      if (dependencyId === pluginId || componentOf.get(dependencyId) === componentOf.get(pluginId)) {
        warn(pluginId, `Optional dependency ${dependencyId} not used: it would close a dependency cycle`);
        continue;
      }
      inUse.add(dependencyId);
    }
    dependencies.set(pluginId, inUse);
    requiredDependencies.set(pluginId, required(pluginId));
  }

  return {
    order: topologicalOrder(remaining, dependencies),
    skipped,
    dependencies,
    requiredDependencies,
    warnings,
    capabilities
  };
}

/** Kahn's algorithm, in registration order where the dependencies allow it. The graph is acyclic by construction. */
function topologicalOrder(plugins: Plugin[], dependencies: Map<string, Set<string>>): Plugin[] {
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  const pluginById = new Map(plugins.map((plugin) => [plugin.manifest.id, plugin]));
  for (const plugin of plugins) {
    inDegree.set(plugin.manifest.id, 0);
    dependents.set(plugin.manifest.id, []);
  }
  for (const plugin of plugins) {
    for (const dependencyId of dependencies.get(plugin.manifest.id) ?? []) {
      inDegree.set(plugin.manifest.id, (inDegree.get(plugin.manifest.id) ?? 0) + 1);
      dependents.get(dependencyId)?.push(plugin.manifest.id);
    }
  }
  const queue = plugins.map((plugin) => plugin.manifest.id).filter((pluginId) => inDegree.get(pluginId) === 0);
  const ordered: Plugin[] = [];
  while (queue.length > 0) {
    const pluginId = queue.shift() as string;
    ordered.push(pluginById.get(pluginId) as Plugin);
    for (const dependentId of dependents.get(pluginId) ?? []) {
      const next = (inDegree.get(dependentId) ?? 0) - 1;
      inDegree.set(dependentId, next);
      if (next === 0) {
        queue.push(dependentId);
      }
    }
  }
  if (ordered.length !== plugins.length) {
    // Not reachable: required cycles are skipped and optional edges in cycles dropped
    throw new Error("Plugin dependency cycle detected");
  }
  return ordered;
}

/** Tarjan's strongly connected components over the given nodes; edges to other nodes are ignored. */
function stronglyConnectedComponents(nodes: string[], edges: (node: string) => string[]): string[][] {
  const nodeSet = new Set(nodes);
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const strongConnect = (node: string) => {
    index.set(node, counter);
    lowLink.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const next of edges(node)) {
      if (!nodeSet.has(next)) {
        continue;
      }
      if (!index.has(next)) {
        strongConnect(next);
        lowLink.set(node, Math.min(lowLink.get(node) as number, lowLink.get(next) as number));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node) as number, index.get(next) as number));
      }
    }
    if (lowLink.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component.reverse());
    }
  };

  for (const node of nodes) {
    if (!index.has(node)) {
      strongConnect(node);
    }
  }
  return components;
}
