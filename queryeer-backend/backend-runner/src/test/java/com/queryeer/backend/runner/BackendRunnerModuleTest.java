package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class BackendRunnerModuleTest
{
    @Test
    void mergeDiscoveredPluginsThrowsOnDuplicateIds()
    {
        DiscoveredPlugin builtin = discovered("duplicate.plugin", null);
        DiscoveredPlugin external = discovered("duplicate.plugin", Path.of("plugins", "duplicate"));

        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> BackendRunnerModule.mergeDiscoveredPlugins(List.of(builtin), List.of(external)));
        Assertions.assertTrue(error.getMessage()
                .contains("Duplicate plugin id discovered in mixed mode"));
    }

    @Test
    void mergeDiscoveredPluginsKeepsOrderWhenIdsAreUnique()
    {
        DiscoveredPlugin builtin = discovered("builtin.one", null);
        DiscoveredPlugin external = discovered("external.two", Path.of("plugins", "external-two"));

        List<DiscoveredPlugin> merged = BackendRunnerModule.mergeDiscoveredPlugins(List.of(builtin), List.of(external));

        Assertions.assertEquals(List.of("builtin.one", "external.two"), merged.stream()
                .map(plugin -> plugin.manifest()
                        .id())
                .toList());
    }

    private DiscoveredPlugin discovered(String pluginId, Path source)
    {
        PluginManifest manifest = new PluginManifest(1, pluginId, pluginId, "0.1.0", new PluginManifest.BackendTarget("com.example.Plugin", null, null, "17"), null, List.of(), List.of(), List.of(),
                null, null);
        return new DiscoveredPlugin(manifest, null, source, false, null);
    }
}
