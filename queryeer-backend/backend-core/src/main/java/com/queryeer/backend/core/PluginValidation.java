package com.queryeer.backend.core;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
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
        Map<String, String> warnings = new LinkedHashMap<>();
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
                String reason = dependencyProblem(descriptor, descriptorById, skipReasons, warnings);
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
            // Its capabilities are then gone too, so the checks above run again. Only required dependencies count here:
            // an optional dependency never skips a plugin (see optionalWithoutCycles)
            Set<String> ordered = new LinkedHashSet<>();
            for (BackendPlugin plugin : topologicalSort(pluginById, descriptorById, skipReasons.keySet(), Map.of()))
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

        Map<String, List<String>> optionalNotes = new LinkedHashMap<>();
        Map<String, Set<String>> activeOptional = activeOptionalDependencies(descriptorById, skipReasons, optionalNotes);
        List<BackendPlugin> sorted = optionalWithoutCycles(pluginById, descriptorById, skipReasons.keySet(), activeOptional, optionalNotes);
        optionalNotes.forEach((id, notes) -> warnings.merge(id, String.join(". ", notes), (required, optional) -> required + ". " + optional));

        for (String id : descriptorById.keySet())
        {
            preStates.put(id, skipReasons.containsKey(id) ? PluginRuntimeState.SKIPPED
                    : PluginRuntimeState.LOADED);
        }

        warnings.keySet()
                .removeAll(skipReasons.keySet());
        Map<String, Set<String>> frozenOptional = new LinkedHashMap<>();
        activeOptional.forEach((id, active) -> frozenOptional.put(id, Set.copyOf(active)));
        return new PluginValidationPlan(sorted, skipReasons, preStates, warnings, Collections.unmodifiableMap(frozenOptional));
    }

    /**
     * The activation order, with the optional dependencies in use as ordering edges. Required dependencies alone have no cycle (those plugins were skipped), so plugins left unordered are in a cycle
     * that an optional dependency closes, including one on itself, or depend on one. Each cycle is a strongly connected component of the unordered plugins: its members stop using their optional
     * dependencies on each other, with a note, and the sort runs again. Optional dependencies between components, or from a plugin outside any cycle, are kept. Within a component, the required edges
     * alone are acyclic, so the next sort orders everything.
     */
    private static List<BackendPlugin> optionalWithoutCycles(Map<String, BackendPlugin> pluginById, Map<String, PluginDescriptor> descriptorById, Set<String> skipped,
            Map<String, Set<String>> activeOptional, Map<String, List<String>> notes)
    {
        while (true)
        {
            List<BackendPlugin> sorted = topologicalSort(pluginById, descriptorById, skipped, activeOptional);
            if (sorted.size() + skipped.size() == descriptorById.size())
            {
                return sorted;
            }
            Set<String> unordered = new LinkedHashSet<>(descriptorById.keySet());
            unordered.removeAll(skipped);
            for (BackendPlugin plugin : sorted)
            {
                unordered.remove(plugin.descriptor()
                        .id());
            }
            Map<String, Integer> component = stronglyConnectedComponents(unordered, descriptorById, activeOptional);
            boolean dropped = false;
            for (String id : unordered)
            {
                Set<String> active = activeOptional.getOrDefault(id, Set.of());
                for (String dependency : List.copyOf(active))
                {
                    // Same component: a self-dependency, or both on one cycle
                    if (component.containsKey(dependency)
                            && component.get(dependency)
                                    .equals(component.get(id))
                            && (dependency.equals(id)
                                    || componentSize(component, component.get(id)) > 1))
                    {
                        active.remove(dependency);
                        notes.computeIfAbsent(id, key -> new ArrayList<>())
                                .add("Optional dependency " + dependency + " not used: it would close a dependency cycle");
                        dropped = true;
                    }
                }
            }
            if (!dropped)
            {
                // Can't happen: a cycle among plugins that aren't skipped contains an optional edge
                return sorted;
            }
        }
    }

    /** Tarjan's algorithm over the given plugins and the ordering edges between them: a component number per plugin. */
    private static Map<String, Integer> stronglyConnectedComponents(Set<String> ids, Map<String, PluginDescriptor> descriptorById, Map<String, Set<String>> activeOptional)
    {
        Map<String, Integer> index = new HashMap<>();
        Map<String, Integer> lowLink = new HashMap<>();
        ArrayDeque<String> stack = new ArrayDeque<>();
        Set<String> onStack = new HashSet<>();
        Map<String, Integer> component = new HashMap<>();
        int[] counters = new int[2]; // next index, next component
        for (String id : ids)
        {
            if (!index.containsKey(id))
            {
                strongConnect(id, ids, descriptorById, activeOptional, index, lowLink, stack, onStack, component, counters);
            }
        }
        return component;
    }

    private static void strongConnect(String id, Set<String> ids, Map<String, PluginDescriptor> descriptorById, Map<String, Set<String>> activeOptional, Map<String, Integer> index,
            Map<String, Integer> lowLink, ArrayDeque<String> stack, Set<String> onStack, Map<String, Integer> component, int[] counters)
    {
        index.put(id, counters[0]);
        lowLink.put(id, counters[0]);
        counters[0]++;
        stack.push(id);
        onStack.add(id);
        for (String next : edges(descriptorById.get(id), activeOptional))
        {
            if (!ids.contains(next))
            {
                continue;
            }
            if (!index.containsKey(next))
            {
                strongConnect(next, ids, descriptorById, activeOptional, index, lowLink, stack, onStack, component, counters);
                lowLink.put(id, Math.min(lowLink.get(id), lowLink.get(next)));
            }
            else if (onStack.contains(next))
            {
                lowLink.put(id, Math.min(lowLink.get(id), index.get(next)));
            }
        }
        if (lowLink.get(id)
                .equals(index.get(id)))
        {
            String member;
            do
            {
                member = stack.pop();
                onStack.remove(member);
                component.put(member, counters[1]);
            } while (!member.equals(id));
            counters[1]++;
        }
    }

    private static long componentSize(Map<String, Integer> component, Integer number)
    {
        return component.values()
                .stream()
                .filter(number::equals)
                .count();
    }

    /** A plugin's ordering edges: its required dependencies and the optional ones it uses. */
    private static Set<String> edges(PluginDescriptor descriptor, Map<String, Set<String>> activeOptional)
    {
        Set<String> edges = new LinkedHashSet<>(descriptor.dependencies());
        edges.addAll(activeOptional.getOrDefault(descriptor.id(), Set.of()));
        return edges;
    }

    /**
     * The optional dependencies each plugin that isn't skipped will use, by plugin id: those that are loaded, not skipped and in range. A range isn't enforced against a development build, as for
     * required dependencies. An optional dependency never skips a plugin.
     *
     * @param notes collects why an optional dependency that is loaded isn't used, or is used out of range, by plugin id; null to skip that
     */
    private static Map<String, Set<String>> activeOptionalDependencies(Map<String, PluginDescriptor> descriptorById, Map<String, String> skipReasons, Map<String, List<String>> notes)
    {
        Map<String, Set<String>> result = new LinkedHashMap<>();
        for (PluginDescriptor descriptor : descriptorById.values())
        {
            if (skipReasons.containsKey(descriptor.id()))
            {
                continue;
            }
            Set<String> active = new LinkedHashSet<>();
            for (String dependency : descriptor.optionalDependencies())
            {
                PluginDescriptor target = descriptorById.get(dependency);
                if (target == null
                        || skipReasons.containsKey(dependency))
                {
                    continue;
                }
                String note = null;
                boolean use = true;
                String range = descriptor.dependencyVersions()
                        .get(dependency);
                if (range != null)
                {
                    try
                    {
                        if (!SemVer.satisfies(target.version(), range))
                        {
                            if (SemVer.isDevelopmentBuild(target.version()))
                            {
                                note = "Needs " + dependency + " " + range + ", but " + target.version() + " is a development build; the range isn't enforced";
                            }
                            else
                            {
                                use = false;
                                note = "Optional dependency " + dependency + " not used: needs " + range + ", but " + target.version() + " is installed";
                            }
                        }
                    }
                    catch (IllegalArgumentException e)
                    {
                        use = false;
                        note = "Optional dependency " + dependency + " not used: cannot check its version: " + e.getMessage();
                    }
                }
                if (use)
                {
                    active.add(dependency);
                }
                if (note != null
                        && notes != null)
                {
                    notes.computeIfAbsent(descriptor.id(), id -> new ArrayList<>())
                            .add(note);
                }
            }
            result.put(descriptor.id(), active);
        }
        return result;
    }

    /**
     * Why a plugin's dependencies are not satisfied, or null when they are. A version range is not enforced against a development build ({@code -SNAPSHOT}), which only runs from source: the plugin
     * loads, with a warning, so plugins built for the last release keep working while core moves to the next one.
     */
    private static String dependencyProblem(PluginDescriptor descriptor, Map<String, PluginDescriptor> descriptorById, Map<String, String> skipReasons, Map<String, String> warnings)
    {
        // One entry per mismatching dependency, written once per call: the validation loop calls this on every pass
        List<String> notEnforced = new ArrayList<>();
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
                        if (!SemVer.isDevelopmentBuild(target.version()))
                        {
                            return "Needs " + dependency + " " + range + ", but " + target.version() + " is installed";
                        }
                        notEnforced.add("Needs " + dependency + " " + range + ", but " + target.version() + " is a development build; the range isn't enforced");
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
        if (!notEnforced.isEmpty())
        {
            warnings.put(descriptor.id(), String.join(". ", notEnforced));
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

    private static List<BackendPlugin> topologicalSort(Map<String, BackendPlugin> pluginById, Map<String, PluginDescriptor> descriptorById, Set<String> skipped,
            Map<String, Set<String>> activeOptional)
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
            // Each dependency once: a repeated entry would count twice in indegree but be released once. Optional dependencies order a plugin only when it uses them
            for (String dependency : edges(descriptor, activeOptional))
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
