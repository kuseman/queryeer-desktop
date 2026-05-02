package com.queryeer.backend.runner;

import java.util.List;

import com.queryeer.backend.api.LoggerService;

final class PluginResourceCloser
{
    private PluginResourceCloser()
    {
    }

    static void closeAll(List<DiscoveredPlugin> plugins, SharedClassLoader sharedLoader, LoggerService logger)
    {
        for (DiscoveredPlugin plugin : plugins)
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
        try
        {
            sharedLoader.close();
        }
        catch (Exception e)
        {
            logger.error("Failed to close shared classloader", e);
        }
    }
}
