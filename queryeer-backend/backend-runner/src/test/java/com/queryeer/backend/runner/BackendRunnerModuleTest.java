package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class BackendRunnerModuleTest
{
    @Test
    void resolveConfigValuesReadsSystemProperties()
    {
        String previousAppDir = System.getProperty("queryeer.app.dir");
        String previousResourcesDir = System.getProperty("queryeer.resources.dir");
        String previousSettingsDir = System.getProperty("queryeer.settings.dir");
        String previousSettingsPath = System.getProperty("queryeer.settings.path");
        String previousPluginsDir = System.getProperty("queryeer.plugins.dir");
        String previousSafeMode = System.getProperty("queryeer.plugins.safeMode");
        try
        {
            System.setProperty("queryeer.app.dir", " C:/appdata ");
            System.setProperty("queryeer.resources.dir", " C:/install/resources ");
            System.setProperty("queryeer.settings.dir", " C:/appdata/settings ");
            System.setProperty("queryeer.settings.path", " C:/appdata/settings/core.queryengine.jdbc.json ");
            System.setProperty("queryeer.plugins.safeMode", "true");
            System.clearProperty("queryeer.plugins.dir");

            Map<String, String> values = BackendRunnerModule.resolveConfigValues();

            Assertions.assertEquals("C:/appdata", values.get("queryeer.app.dir"));
            Assertions.assertEquals("C:/install/resources", values.get("queryeer.resources.dir"));
            Assertions.assertEquals("C:/appdata/settings", values.get("queryeer.settings.dir"));
            Assertions.assertEquals("C:/appdata/settings/core.queryengine.jdbc.json", values.get("queryeer.settings.path"));
            Assertions.assertEquals(Path.of("C:/appdata", "plugins")
                    .toString(), values.get("queryeer.plugins.dir"));
            Assertions.assertEquals("true", values.get("queryeer.plugins.safeMode"));
        }
        finally
        {
            restoreProperty("queryeer.app.dir", previousAppDir);
            restoreProperty("queryeer.resources.dir", previousResourcesDir);
            restoreProperty("queryeer.settings.dir", previousSettingsDir);
            restoreProperty("queryeer.settings.path", previousSettingsPath);
            restoreProperty("queryeer.plugins.dir", previousPluginsDir);
            restoreProperty("queryeer.plugins.safeMode", previousSafeMode);
        }
    }

    @Test
    void mergeDiscoveredPluginsThrowsOnDuplicateIds()
    {
        DiscoveredPlugin builtin = discovered("duplicate.plugin", null);
        DiscoveredPlugin external = discovered("duplicate.plugin", Path.of("plugins", "duplicate"));

        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> BackendRunnerModule.mergeDiscoveredPlugins(List.of(builtin), List.of(external)));
        Assertions.assertTrue(error.getMessage()
                .contains("Duplicate external plugin id conflicts"));
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
        PluginManifest manifest = new PluginManifest(1, pluginId, pluginId, "0.1.0", new PluginManifest.BackendTarget("com.example.Plugin", null, null), null, List.of(), List.of(), List.of(), null,
                null, null);
        return new DiscoveredPlugin(manifest, null, source, false, null);
    }

    private static void restoreProperty(String key, String previous)
    {
        if (previous == null)
        {
            System.clearProperty(key);
        }
        else
        {
            System.setProperty(key, previous);
        }
    }
}
