package com.queryeer.backend.runner;

import java.util.List;

import com.queryeer.backend.api.LoggerService;

final class PluginResourceCloser
{
    private PluginResourceCloser()
    {
    }

    static void closeClassLoaders(List<DiscoveredPlugin> discoveredPlugins, LoggerService logger)
    {
        for (DiscoveredPlugin plugin : discoveredPlugins)
        {
            AutoCloseable classLoaderResource = plugin.classLoaderResource();
            if (classLoaderResource == null)
            {
                continue;
            }
            try
            {
                classLoaderResource.close();
            }
            catch (Exception e)
            {
                logger.error("Failed to close plugin classloader resource for " + plugin.manifest()
                        .id(), e);
            }
        }
    }
}
