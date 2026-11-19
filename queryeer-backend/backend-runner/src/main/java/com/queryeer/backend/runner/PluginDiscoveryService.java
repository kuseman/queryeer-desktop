package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import com.queryeer.backend.api.PluginHostServices;

final class PluginDiscoveryService
{
    private final PluginSourceExplorer sourceExplorer;
    private final PluginManifestLoader manifestLoader;
    private final BackendPluginResolver backendResolver;
    private final FrontendPluginResolver frontendResolver;

    PluginDiscoveryService(PluginHostServices hostServices, PluginClassLoaderFactory classLoaderFactory)
    {
        this.sourceExplorer = new PluginSourceExplorer();
        this.manifestLoader = new PluginManifestLoader();
        this.backendResolver = new ManifestBackendPluginResolver(classLoaderFactory, new PluginFactory(), hostServices);
        this.frontendResolver = new ManifestFrontendPluginResolver();
    }

    DiscoveryResult discoverFromPath(String pathValue)
    {
        Path pluginsDirectory = Paths.get(pathValue);
        return discoverFromSources(sourceExplorer.discoverPluginSources(pluginsDirectory));
    }

    /**
     * Plugins from the given plugin folders or zips, each one plugin. A source that can't be loaded (an invalid or unreadable manifest, a broken classpath, an id found earlier) is skipped and listed
     * in {@link DiscoveryResult#failures()}, so one broken plugin doesn't stop the others. The caller decides whether a failure is fatal: for built-in plugins it is.
     */
    DiscoveryResult discoverFromSources(List<Path> sources)
    {
        List<DiscoveredPlugin> backendPlugins = new ArrayList<>();
        List<FrontendPluginResolver.ResolvedFrontendPlugin> frontendPlugins = new ArrayList<>();
        List<DiscoveryFailure> failures = new ArrayList<>();
        Set<String> seenPluginIds = new HashSet<>();

        for (Path source : sources)
        {
            String pluginId = null;
            try
            {
                PluginManifest manifest = manifestLoader.load(source);
                pluginId = manifest.id();
                if (seenPluginIds.contains(pluginId))
                {
                    failures.add(new DiscoveryFailure(pluginId, source, "Duplicate plugin id discovered: " + pluginId + " (source: " + source + ")"));
                    continue;
                }

                // The frontend first: the backend creates a class loader, which a later failure would leave open
                Optional<FrontendPluginResolver.ResolvedFrontendPlugin> frontend = frontendResolver.resolve(manifest, source);
                Optional<DiscoveredPlugin> backend = backendResolver.resolve(manifest, source);
                // Claimed only once loaded, so a broken copy doesn't keep a working one with the same id out
                seenPluginIds.add(pluginId);
                frontend.ifPresent(frontendPlugins::add);
                backend.ifPresent(backendPlugins::add);
            }
            catch (RuntimeException e)
            {
                failures.add(new DiscoveryFailure(pluginId != null ? pluginId
                        : idFromSource(source), source,
                        e.getMessage() != null ? e.getMessage()
                                : e.toString()));
            }
        }

        return new DiscoveryResult(backendPlugins, frontendPlugins, failures, seenPluginIds);
    }

    /** A name for a plugin whose manifest was refused: the id in it if its JSON can be read, otherwise its folder or zip name. */
    static String idFromSource(Path source)
    {
        String id = PluginManifestLoader.readIdLeniently(source);
        if (id != null)
        {
            return id;
        }
        Path fileName = source.getFileName();
        return fileName != null ? fileName.toString()
                : source.toString();
    }

    /** {@code loadedIds} are the plugins that loaded, also those without a backend. */
    record DiscoveryResult(List<DiscoveredPlugin> backendPlugins, List<FrontendPluginResolver.ResolvedFrontendPlugin> frontendPlugins, List<DiscoveryFailure> failures, Set<String> loadedIds)
    {
    }

    /** A plugin source that was skipped. {@code pluginId} is the manifest's id, or the folder or zip name when the manifest couldn't be read. */
    record DiscoveryFailure(String pluginId, Path source, String reason)
    {
    }
}
