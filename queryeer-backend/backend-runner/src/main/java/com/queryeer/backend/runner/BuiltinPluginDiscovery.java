package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;

final class BuiltinPluginDiscovery
{
    private final PluginDiscoveryService discoveryService;
    private final Path builtinsDir;
    private final String backendVersion;

    BuiltinPluginDiscovery(PluginDiscoveryService discoveryService, Path builtinsDir)
    {
        this(discoveryService, builtinsDir, null);
    }

    /**
     * @param backendVersion the version every built-in plugin reports, so other plugins can declare a version range for them; null keeps the versions in the manifests
     */
    BuiltinPluginDiscovery(PluginDiscoveryService discoveryService, Path builtinsDir, String backendVersion)
    {
        this.discoveryService = discoveryService;
        this.builtinsDir = builtinsDir;
        this.backendVersion = backendVersion;
    }

    List<DiscoveredPlugin> discover()
    {
        PluginDiscoveryService.DiscoveryResult result = discoveryService.discoverFromPath(builtinsDir.toString());
        // A built-in plugin that can't be loaded is a broken installation, not a plugin to skip
        if (!result.failures()
                .isEmpty())
        {
            PluginDiscoveryService.DiscoveryFailure failure = result.failures()
                    .get(0);
            throw new PluginDiscoveryException("Built-in plugin " + failure.pluginId() + " could not be loaded: " + failure.reason());
        }
        List<DiscoveredPlugin> plugins = result.backendPlugins();
        if (plugins.isEmpty())
        {
            throw new PluginDiscoveryException("No builtin backend plugins discovered from: " + builtinsDir);
        }
        if (backendVersion == null)
        {
            return plugins;
        }
        return plugins.stream()
                .map(this::withBackendVersion)
                .toList();
    }

    private DiscoveredPlugin withBackendVersion(DiscoveredPlugin discovered)
    {
        PluginManifest manifest = discovered.manifest()
                .withVersion(backendVersion);
        // Plugins created by the manifest resolver describe themselves from the manifest
        return discovered.plugin() instanceof PluginManifestBackedPlugin backed
                ? new DiscoveredPlugin(manifest, backed.withManifest(manifest), discovered.source(), discovered.isolatedClassLoader(), discovered.classLoaderResource())
                : discovered;
    }
}
