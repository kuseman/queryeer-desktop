package com.queryeer.backend.runner;

import java.nio.file.Path;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginFactory;
import com.queryeer.backend.api.PluginHostServices;

final class PluginFactory
{
    BackendPlugin instantiate(PluginManifest manifest, ClassLoader classLoader, Path source, PluginHostServices hostServices)
    {
        if (manifest.backend() == null)
        {
            throw new PluginDiscoveryException("Backend target is required for backend instantiation: " + manifest.id() + " (" + source + ")");
        }

        String factoryClass = manifest.backend()
                .factoryClass();
        if (factoryClass != null
                && !factoryClass.isBlank())
        {
            return instantiateFromFactory(factoryClass, classLoader, source, hostServices);
        }

        String entrypointClass = manifest.backend()
                .entrypointClass();
        if (entrypointClass == null
                || entrypointClass.isBlank())
        {
            throw new PluginDiscoveryException("Backend entrypointClass is required when factoryClass is not provided: " + manifest.id() + " (" + source + ")");
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

    private BackendPlugin instantiateFromFactory(String factoryClassName, ClassLoader classLoader, Path source, PluginHostServices hostServices)
    {
        try
        {
            Class<?> rawType = Class.forName(factoryClassName, true, classLoader);
            if (!BackendPluginFactory.class.isAssignableFrom(rawType))
            {
                throw new PluginDiscoveryException("Factory does not implement BackendPluginFactory: " + factoryClassName + " (" + source + ")");
            }

            @SuppressWarnings("unchecked")
            Class<? extends BackendPluginFactory> factoryClass = (Class<? extends BackendPluginFactory>) rawType;
            BackendPluginFactory factory = factoryClass.getDeclaredConstructor()
                    .newInstance();
            BackendPlugin plugin = factory.create(hostServices);
            if (plugin == null)
            {
                throw new PluginDiscoveryException("BackendPluginFactory returned null plugin: " + factoryClassName + " (" + source + ")");
            }
            return plugin;
        }
        catch (PluginDiscoveryException e)
        {
            throw e;
        }
        catch (ReflectiveOperationException e)
        {
            throw new PluginDiscoveryException("Failed to instantiate plugin factory: " + factoryClassName + " (" + source + ")", e);
        }
    }
}
