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

        for (PluginDescriptor descriptor : descriptorById.values())
        {
            String id = descriptor.id();

            if (hasMissingDependency(descriptor, descriptorById.keySet()))
            {
                skipReasons.put(id, "Missing dependency");
                preStates.put(id, PluginRuntimeState.SKIPPED);
                continue;
            }

            if (hasMissingRequiredCapability(descriptor, descriptorById.values()))
            {
                skipReasons.put(id, "Missing required capability");
                preStates.put(id, PluginRuntimeState.SKIPPED);
                continue;
            }

            preStates.put(id, PluginRuntimeState.LOADED);
        }

        List<BackendPlugin> sorted = topologicalSort(pluginById, descriptorById, skipReasons.keySet());
        return new PluginValidationPlan(sorted, skipReasons, preStates);
    }

    private static boolean hasMissingDependency(PluginDescriptor descriptor, Set<String> knownPluginIds)
    {
        for (String dependency : descriptor.dependencies())
        {
            if (!knownPluginIds.contains(dependency))
            {
                return true;
            }
        }
        return false;
    }

    private static boolean hasMissingRequiredCapability(PluginDescriptor descriptor, Iterable<PluginDescriptor> allDescriptors)
    {
        Set<String> providedCapabilities = new LinkedHashSet<>();
        for (PluginDescriptor candidate : allDescriptors)
        {
            providedCapabilities.addAll(candidate.providesCapabilities());
        }

        for (String required : descriptor.requiredCapabilities())
        {
            if (!providedCapabilities.contains(required))
            {
                return true;
            }
        }
        return false;
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
            for (String dependency : descriptor.dependencies())
            {
                if (!indegree.containsKey(dependency))
                {
                    continue;
                }
                indegree.compute(descriptor.id(), (k, v) -> Objects.requireNonNull(v) + 1);
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
        int visited = 0;
        while (!queue.isEmpty())
        {
            String current = queue.removeFirst();
            ordered.add(pluginById.get(current));
            visited++;

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

        if (visited != indegree.size())
        {
            throw new IllegalStateException("Plugin dependency cycle detected");
        }

        return ordered;
    }
}
