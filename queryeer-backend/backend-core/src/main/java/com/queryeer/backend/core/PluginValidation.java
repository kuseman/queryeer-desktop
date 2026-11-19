package com.queryeer.backend.core;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.PluginDescriptor;

public final class PluginValidation
{
    private PluginValidation()
    {
    }

    public static void validateUniqueIds(List<BackendPlugin> plugins)
    {
        Set<String> ids = new HashSet<>();
        for (BackendPlugin plugin : plugins)
        {
            PluginDescriptor descriptor = plugin.descriptor();
            if (!ids.add(descriptor.id()))
            {
                throw new IllegalStateException("Duplicate plugin id: " + descriptor.id());
            }
        }
    }

    public static PluginValidationPlan planActivation(List<BackendPlugin> plugins)
    {
        validateUniqueIds(plugins);

        Map<String, BackendPlugin> pluginById = new LinkedHashMap<>();
        Map<String, PluginDescriptor> descriptorById = new LinkedHashMap<>();
        for (BackendPlugin plugin : plugins)
        {
            PluginDescriptor descriptor = plugin.descriptor();
            pluginById.put(descriptor.id(), plugin);
            descriptorById.put(descriptor.id(), descriptor);
        }

        Map<String, String> skipReasons = new LinkedHashMap<>();
        Map<String, PluginRuntimeState> preStates = new LinkedHashMap<>();

        // Skipping a plugin can leave its dependents without a dependency or a capability, so repeat until nothing changes
        boolean changed = true;
        while (changed)
        {
            changed = false;
            Set<String> providedCapabilities = new LinkedHashSet<>();
            for (PluginDescriptor descriptor : descriptorById.values())
            {
                if (!skipReasons.containsKey(descriptor.id()))
                {
                    providedCapabilities.addAll(descriptor.providesCapabilities());
                }
            }
            for (PluginDescriptor descriptor : descriptorById.values())
            {
                if (skipReasons.containsKey(descriptor.id()))
                {
                    continue;
                }
                String reason = dependencyProblem(descriptor, descriptorById, skipReasons);
                if (reason == null)
                {
                    reason = missingRequiredCapability(descriptor, providedCapabilities);
                }
                if (reason != null)
                {
                    skipReasons.put(descriptor.id(), reason);
                    changed = true;
                }
            }
            if (changed)
            {
                continue;
            }

            // A plugin in a dependency cycle, or depending on one, can't be ordered: it is skipped, the others still run.
            // Its capabilities are then gone too, so the checks above run again.
            Set<String> ordered = new LinkedHashSet<>();
            for (BackendPlugin plugin : topologicalSort(pluginById, descriptorById, skipReasons.keySet()))
            {
                ordered.add(plugin.descriptor()
                        .id());
            }
            for (String id : descriptorById.keySet())
            {
                if (!skipReasons.containsKey(id)
                        && !ordered.contains(id))
                {
                    skipReasons.put(id, "Dependency cycle: " + id + " depends on itself, directly or through other plugins, or on a plugin that does");
                    changed = true;
                }
            }
        }

        List<BackendPlugin> sorted = topologicalSort(pluginById, descriptorById, skipReasons.keySet());

        for (String id : descriptorById.keySet())
        {
            preStates.put(id, skipReasons.containsKey(id) ? PluginRuntimeState.SKIPPED
                    : PluginRuntimeState.LOADED);
        }

        return new PluginValidationPlan(sorted, skipReasons, preStates);
    }

    /** Why a plugin's dependencies are not satisfied, or null when they are. */
    private static String dependencyProblem(PluginDescriptor descriptor, Map<String, PluginDescriptor> descriptorById, Map<String, String> skipReasons)
    {
        for (String dependency : descriptor.dependencies())
        {
            PluginDescriptor target = descriptorById.get(dependency);
            if (target == null)
            {
                return "Missing dependency: " + dependency;
            }
            String range = descriptor.dependencyVersions()
                    .get(dependency);
            if (range != null)
            {
                try
                {
                    if (!SemVer.satisfies(target.version(), range))
                    {
                        return "Needs " + dependency + " " + range + ", but " + target.version() + " is installed";
                    }
                }
                catch (IllegalArgumentException e)
                {
                    return "Cannot check the version of " + dependency + ": " + e.getMessage();
                }
            }
            if (skipReasons.containsKey(dependency))
            {
                return "Dependency " + dependency + " was skipped";
            }
        }
        return null;
    }

    private static String missingRequiredCapability(PluginDescriptor descriptor, Set<String> providedCapabilities)
    {
        for (String required : descriptor.requiredCapabilities())
        {
            if (!providedCapabilities.contains(required))
            {
                return "Missing required capability: " + required;
            }
        }
        return null;
    }

    private static List<BackendPlugin> topologicalSort(Map<String, BackendPlugin> pluginById, Map<String, PluginDescriptor> descriptorById, Set<String> skipped)
    {
        Map<String, Integer> indegree = new LinkedHashMap<>();
        Map<String, Set<String>> dependents = new LinkedHashMap<>();

        for (String pluginId : pluginById.keySet())
        {
            if (skipped.contains(pluginId))
            {
                continue;
            }
            indegree.put(pluginId, 0);
            dependents.put(pluginId, new LinkedHashSet<>());
        }

        for (PluginDescriptor descriptor : descriptorById.values())
        {
            if (skipped.contains(descriptor.id()))
            {
                continue;
            }
            // Each dependency once: a repeated entry would count twice in indegree but be released once
            for (String dependency : new LinkedHashSet<>(descriptor.dependencies()))
            {
                if (!indegree.containsKey(dependency))
                {
                    continue;
                }
                indegree.compute(descriptor.id(), (_, v) -> Objects.requireNonNull(v) + 1);
                dependents.get(dependency)
                        .add(descriptor.id());
            }
        }

        ArrayDeque<String> queue = new ArrayDeque<>();
        for (Map.Entry<String, Integer> entry : indegree.entrySet())
        {
            if (entry.getValue() == 0)
            {
                queue.add(entry.getKey());
            }
        }

        List<BackendPlugin> ordered = new ArrayList<>();
        while (!queue.isEmpty())
        {
            String current = queue.removeFirst();
            ordered.add(pluginById.get(current));

            for (String dependent : dependents.get(current))
            {
                int updated = indegree.get(dependent) - 1;
                indegree.put(dependent, updated);
                if (updated == 0)
                {
                    queue.addLast(dependent);
                }
            }
        }

        // Plugins left out are in a cycle or depend on one; planActivation skips them
        return ordered;
    }
}
