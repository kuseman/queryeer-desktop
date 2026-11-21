package com.queryeer.backend.contract.runtime;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * A backend plugin's runtime state. The descriptor fields ({@code name} to {@code requiredCapabilities}) are set for plugins that were discovered, and omitted for plugins that failed before their
 * descriptor was read.
 *
 * @param dependencies ids of the plugins this plugin can't load without
 * @param optionalDependencies ids of the plugins this plugin uses when they are loaded
 */
public record RuntimePluginStatus(String pluginId, RuntimePluginState state, String reason, @JsonInclude(JsonInclude.Include.NON_NULL) String name,
        @JsonInclude(JsonInclude.Include.NON_NULL) String version, @JsonInclude(JsonInclude.Include.NON_NULL) List<String> dependencies,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<String> optionalDependencies, @JsonInclude(JsonInclude.Include.NON_NULL) List<String> providesCapabilities,
        @JsonInclude(JsonInclude.Include.NON_NULL) List<String> requiredCapabilities)
{
    /** A status without descriptor fields. */
    public RuntimePluginStatus(String pluginId, RuntimePluginState state, String reason)
    {
        this(pluginId, state, reason, null, null, null, null, null, null);
    }
}
