package com.queryeer.backend.runner;

import java.util.Optional;

record PluginDiscoveryPlan(PluginDiscoveryMode mode, Optional<String> pluginPath)
{
    static PluginDiscoveryPlan of(PluginDiscoveryMode mode, Optional<String> pluginPath)
    {
        return new PluginDiscoveryPlan(mode, pluginPath == null ? Optional.empty()
                : pluginPath);
    }

    PluginDiscoveryMode effectiveMode()
    {
        if (mode != PluginDiscoveryMode.AUTO)
        {
            return mode;
        }
        return pluginPath.isPresent() ? PluginDiscoveryMode.MIXED
                : PluginDiscoveryMode.BUILTIN;
    }

    String requiredPathFor(PluginDiscoveryMode requiredMode)
    {
        if (requiredMode == PluginDiscoveryMode.BUILTIN)
        {
            throw new IllegalArgumentException("BUILTIN mode does not require plugin path");
        }
        return pluginPath.orElseThrow(() -> new PluginDiscoveryException("Plugin discovery mode " + requiredMode.name()
                .toLowerCase() + " requires queryeer.plugins.path or QUERYEER_PLUGINS_PATH"));
    }
}
