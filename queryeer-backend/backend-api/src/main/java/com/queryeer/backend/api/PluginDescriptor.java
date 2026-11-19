package com.queryeer.backend.api;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A plugin's identity and its declared relations to other plugins.
 *
 * @param dependencies ids of the plugins this plugin can't load without
 * @param dependencyVersions SemVer ranges (npm syntax, e.g. {@code ^0.20.0}) for the dependencies that declare one, required and optional, keyed by dependency id. A dependency without an entry
 * accepts any version.
 * @param optionalDependencies ids of the plugins this plugin uses when they are loaded and in range, and loads without otherwise. Ask {@link BackendPluginContext#isDependencyActive(String)} before
 * touching their classes or services.
 */
public record PluginDescriptor(String id, String name, String version, List<String> dependencies, List<String> providesCapabilities, List<String> requiredCapabilities,
        Map<String, String> dependencyVersions, List<String> optionalDependencies)
{
    public PluginDescriptor
    {
        Map<String, String> ranges = new LinkedHashMap<>();
        if (dependencyVersions != null)
        {
            // A null id or range means no range
            dependencyVersions.forEach((dependency, range) ->
            {
                if (dependency != null
                        && range != null)
                {
                    ranges.put(dependency, range);
                }
            });
        }
        dependencyVersions = Collections.unmodifiableMap(ranges);
        optionalDependencies = optionalDependencies == null ? List.of()
                : List.copyOf(optionalDependencies);
    }

    /** A descriptor without optional dependencies. */
    public PluginDescriptor(String id, String name, String version, List<String> dependencies, List<String> providesCapabilities, List<String> requiredCapabilities,
            Map<String, String> dependencyVersions)
    {
        this(id, name, version, dependencies, providesCapabilities, requiredCapabilities, dependencyVersions, List.of());
    }

    /** A descriptor whose dependencies accept any version. */
    public PluginDescriptor(String id, String name, String version, List<String> dependencies, List<String> providesCapabilities, List<String> requiredCapabilities)
    {
        this(id, name, version, dependencies, providesCapabilities, requiredCapabilities, Map.of(), List.of());
    }
}
