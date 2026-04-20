package com.queryeer.backend.runner;

import java.nio.file.Path;

import com.queryeer.backend.api.BackendPlugin;

final class PluginFactory
{
    BackendPlugin instantiate(PluginManifest manifest, ClassLoader classLoader, Path source)
    {
        if (manifest.backend() == null)
        {
            throw new PluginDiscoveryException("Backend target is required for backend instantiation: " + manifest.id() + " (" + source + ")");
        }

        try
        {
            Class<?> rawType = Class.forName(manifest.backend()
                    .entrypointClass(), true, classLoader);
            if (!BackendPlugin.class.isAssignableFrom(rawType))
            {
                throw new PluginDiscoveryException("Entrypoint does not implement BackendPlugin: " + manifest.backend()
                        .entrypointClass() + " (" + source + ")");
            }

            @SuppressWarnings("unchecked")
            Class<? extends BackendPlugin> pluginClass = (Class<? extends BackendPlugin>) rawType;
            return pluginClass.getDeclaredConstructor()
                    .newInstance();
        }
        catch (PluginDiscoveryException e)
        {
            throw e;
        }
        catch (ReflectiveOperationException e)
        {
            throw new PluginDiscoveryException("Failed to instantiate plugin: " + manifest.backend()
                    .entrypointClass() + " (" + source + ")", e);
        }
    }
}
