package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.PluginHostServices;

final class PluginDiscoveryService
{
    private final PluginSourceExplorer sourceExplorer;
    private final PluginManifestLoader manifestLoader;
    private final BackendPluginResolver backendResolver;
    private final FrontendPluginResolver frontendResolver;

    PluginDiscoveryService(ObjectMapper objectMapper, PluginHostServices hostServices, PluginClassLoaderFactory classLoaderFactory)
    {
        this.sourceExplorer = new PluginSourceExplorer();
        this.manifestLoader = new PluginManifestLoader(objectMapper);
        this.backendResolver = new ManifestBackendPluginResolver(classLoaderFactory, new PluginFactory(), hostServices);
        this.frontendResolver = new ManifestFrontendPluginResolver();
    }

    DiscoveryResult discoverFromPath(String pathValue)
    {
        Path pluginsDirectory = Paths.get(pathValue);
        List<Path> sources = sourceExplorer.discoverPluginSources(pluginsDirectory);
        List<DiscoveredPlugin> backendPlugins = new ArrayList<>();
        List<FrontendPluginResolver.ResolvedFrontendPlugin> frontendPlugins = new ArrayList<>();
        Set<String> seenPluginIds = new HashSet<>();

        for (Path source : sources)
        {
            PluginManifest manifest = manifestLoader.load(source);
            if (seenPluginIds.contains(manifest.id()))
            {
                throw new PluginDiscoveryException("Duplicate plugin id discovered: " + manifest.id() + " (source: " + source + ")");
            }
            seenPluginIds.add(manifest.id());

            backendResolver.resolve(manifest, source)
                    .ifPresent(backendPlugins::add);

            frontendResolver.resolve(manifest, source)
                    .ifPresent(frontendPlugins::add);
        }

        return new DiscoveryResult(backendPlugins, frontendPlugins);
    }

    record DiscoveryResult(List<DiscoveredPlugin> backendPlugins, List<FrontendPluginResolver.ResolvedFrontendPlugin> frontendPlugins)
    {
    }
}
