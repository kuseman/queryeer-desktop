package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;

final class BuiltinPluginDiscovery
{
    private final PluginDiscoveryService discoveryService;
    private final Path builtinsDir;

    BuiltinPluginDiscovery(PluginDiscoveryService discoveryService, Path builtinsDir)
    {
        this.discoveryService = discoveryService;
        this.builtinsDir = builtinsDir;
    }

    List<DiscoveredPlugin> discover()
    {
        List<DiscoveredPlugin> plugins = discoveryService.discoverFromPath(builtinsDir.toString())
                .backendPlugins();
        if (plugins.isEmpty())
        {
            throw new PluginDiscoveryException("No builtin backend plugins discovered from: " + builtinsDir);
        }
        return plugins;
    }
}
