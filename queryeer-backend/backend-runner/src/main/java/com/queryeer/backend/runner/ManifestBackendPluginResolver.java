package com.queryeer.backend.runner;

import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.Optional;

import com.queryeer.backend.api.BackendPlugin;

final class ManifestBackendPluginResolver implements BackendPluginResolver
{
    private final PluginClasspathFactory classpathFactory;
    private final PluginFactory pluginFactory;

    ManifestBackendPluginResolver(PluginClasspathFactory classpathFactory, PluginFactory pluginFactory)
    {
        this.classpathFactory = classpathFactory;
        this.pluginFactory = pluginFactory;
    }

    @Override
    public Optional<BackendPlugin> resolve(PluginManifest manifest, Path source)
    {
        if (manifest.backend() == null)
        {
            return Optional.empty();
        }

        URLClassLoader classLoader = classpathFactory.createClassLoader(source, BackendRunnerApp.class.getClassLoader());
        BackendPlugin plugin = pluginFactory.instantiate(manifest, classLoader, source);
        return Optional.of(new PluginManifestBackedPlugin(manifest, plugin));
    }
}
