package com.queryeer.backend.api;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A plugin's identity and its declared relations to other plugins.
 *
 * @param dependencies ids of the plugins this plugin depends on
 * @param dependencyVersions SemVer ranges (npm syntax, e.g. {@code ^0.20.0}) for the dependencies that declare one, keyed by dependency id. A dependency without an entry accepts any version.
 */
public record PluginDescriptor(String id, String name, String version, List<String> dependencies, List<String> providesCapabilities, List<String> requiredCapabilities,
        Map<String, String> dependencyVersions)
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
    }

    /** A descriptor whose dependencies accept any version. */
    public PluginDescriptor(String id, String name, String version, List<String> dependencies, List<String> providesCapabilities, List<String> requiredCapabilities)
    {
        this(id, name, version, dependencies, providesCapabilities, requiredCapabilities, Map.of());
    }
}
