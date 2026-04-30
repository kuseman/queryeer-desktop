package com.queryeer.backend.runner;

import java.net.URLClassLoader;
import java.nio.file.Path;
import java.util.Optional;

import com.queryeer.backend.api.PluginHostServices;

final class ManifestBackendPluginResolver implements BackendPluginResolver
{
    private final PluginClasspathFactory classpathFactory;
    private final PluginFactory pluginFactory;
    private final PluginHostServices hostServices;

    ManifestBackendPluginResolver(PluginClasspathFactory classpathFactory, PluginFactory pluginFactory, PluginHostServices hostServices)
    {
        this.classpathFactory = classpathFactory;
        this.pluginFactory = pluginFactory;
        this.hostServices = hostServices;
    }

    @Override
    public Optional<DiscoveredPlugin> resolve(PluginManifest manifest, Path source)
    {
        if (manifest.backend() == null)
        {
            return Optional.empty();
        }

        URLClassLoader classLoader = classpathFactory.createClassLoader(source, BackendRunnerApp.class.getClassLoader());
        return Optional.of(new DiscoveredPlugin(manifest, new PluginManifestBackedPlugin(manifest, pluginFactory.instantiate(manifest, classLoader, source, hostServices)), source, true, classLoader));
    }
}
