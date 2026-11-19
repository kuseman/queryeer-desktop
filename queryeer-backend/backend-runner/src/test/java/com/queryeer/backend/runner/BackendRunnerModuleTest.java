package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class BackendRunnerModuleTest
{
    @Test
    void resolveConfigValuesReadsSystemProperties()
    {
        String previousAppDir = System.getProperty("queryeer.app.dir");
        String previousResourcesDir = System.getProperty("queryeer.resources.dir");
        String previousBuiltinsDir = System.getProperty("queryeer.builtins.dir");
        String previousSettingsDir = System.getProperty("queryeer.settings.dir");
        String previousSettingsPath = System.getProperty("queryeer.settings.path");
        String previousPluginsDir = System.getProperty("queryeer.plugins.dir");
        String previousSafeMode = System.getProperty("queryeer.plugins.safeMode");
        String previousDisabledIds = System.getProperty("queryeer.plugins.disabledIds");
        try
        {
            System.setProperty("queryeer.app.dir", " C:/appdata ");
            System.setProperty("queryeer.resources.dir", " C:/install/resources ");
            System.setProperty("queryeer.builtins.dir", " C:/install/builtins ");
            System.setProperty("queryeer.settings.dir", " C:/appdata/settings ");
            System.setProperty("queryeer.settings.path", " C:/appdata/settings/core.queryengine.jdbc.json ");
            System.setProperty("queryeer.plugins.safeMode", "true");
            System.setProperty("queryeer.plugins.disabledIds", " external.one, external.two ");
            System.clearProperty("queryeer.plugins.dir");

            Map<String, String> values = BackendRunnerModule.resolveConfigValues();

            Assertions.assertEquals("C:/appdata", values.get("queryeer.app.dir"));
            Assertions.assertEquals("C:/install/resources", values.get("queryeer.resources.dir"));
            Assertions.assertEquals("C:/install/builtins", values.get("queryeer.builtins.dir"));
            Assertions.assertEquals("C:/appdata/settings", values.get("queryeer.settings.dir"));
            Assertions.assertEquals("C:/appdata/settings/core.queryengine.jdbc.json", values.get("queryeer.settings.path"));
            Assertions.assertEquals(Path.of("C:/appdata", "plugins")
                    .toString(), values.get("queryeer.plugins.dir"));
            Assertions.assertEquals("true", values.get("queryeer.plugins.safeMode"));
            Assertions.assertEquals("external.one, external.two", values.get("queryeer.plugins.disabledIds"));
        }
        finally
        {
            restoreProperty("queryeer.app.dir", previousAppDir);
            restoreProperty("queryeer.resources.dir", previousResourcesDir);
            restoreProperty("queryeer.builtins.dir", previousBuiltinsDir);
            restoreProperty("queryeer.settings.dir", previousSettingsDir);
            restoreProperty("queryeer.settings.path", previousSettingsPath);
            restoreProperty("queryeer.plugins.dir", previousPluginsDir);
            restoreProperty("queryeer.plugins.safeMode", previousSafeMode);
            restoreProperty("queryeer.plugins.disabledIds", previousDisabledIds);
        }
    }

    @Test
    void explicitBuiltinsDirectoryTakesPrecedence()
    {
        Path configured = Path.of("configured-builtins")
                .toAbsolutePath()
                .normalize();

        Path resolved = BackendRunnerModule.resolveBuiltinsDir(configured.toString(), Path.of("resources"), Path.of("app"));

        Assertions.assertEquals(configured, resolved);
    }

    @Test
    void parseDisabledPluginIdsTrimsAndDeduplicatesCsv()
    {
        Assertions.assertEquals(List.of("external.one", "external.two"), BackendRunnerModule.parseDisabledPluginIds(" external.one, , external.two, external.one ")
                .stream()
                .toList());
    }

    @Test
    void filterDisabledExternalPluginsRemovesOnlyConfiguredExternalIds()
    {
        DiscoveredPlugin first = discovered("external.one", Path.of("plugins", "external-one"));
        DiscoveredPlugin second = discovered("external.two", Path.of("plugins", "external-two"));

        List<DiscoveredPlugin> filtered = BackendRunnerModule.filterDisabledExternalPlugins(List.of(first, second), BackendRunnerModule.parseDisabledPluginIds("external.two"));

        Assertions.assertEquals(List.of("external.one"), filtered.stream()
                .map(plugin -> plugin.manifest()
                        .id())
                .toList());
    }

    @Test
    void mergeDiscoveredPluginsSkipsAndReportsAnExternalPluginWithABuiltinId()
    {
        DiscoveredPlugin builtin = discovered("duplicate.plugin", null);
        DiscoveredPlugin external = discovered("duplicate.plugin", Path.of("plugins", "duplicate"));
        List<PluginDiscoveryService.DiscoveryFailure> failures = new ArrayList<>();

        List<DiscoveredPlugin> merged = BackendRunnerModule.mergeDiscoveredPlugins(List.of(builtin), List.of(external), failures);

        Assertions.assertEquals(List.of(builtin), merged);
        Assertions.assertEquals(1, failures.size());
        Assertions.assertTrue(failures.get(0)
                .reason()
                .contains("Duplicate external plugin id conflicts"));
    }

    @Test
    void mergeDiscoveredPluginsKeepsOrderWhenIdsAreUnique()
    {
        DiscoveredPlugin builtin = discovered("builtin.one", null);
        DiscoveredPlugin external = discovered("external.two", Path.of("plugins", "external-two"));

        List<DiscoveredPlugin> merged = BackendRunnerModule.mergeDiscoveredPlugins(List.of(builtin), List.of(external), new ArrayList<>());

        Assertions.assertEquals(List.of("builtin.one", "external.two"), merged.stream()
                .map(plugin -> plugin.manifest()
                        .id())
                .toList());
    }

    @Test
    void developerPluginFolderReplacesAnInstalledPluginWithTheSameId()
    {
        DiscoveredPlugin development = discovered("external.one", Path.of("dev", "external-one"));
        DiscoveredPlugin installedSame = discovered("external.one", Path.of("plugins", "external-one"));
        DiscoveredPlugin installedOther = discovered("external.two", Path.of("plugins", "external-two"));

        List<DiscoveredPlugin> result = BackendRunnerModule.preferDevelopmentPlugins(List.of(development), Set.of("external.one"), List.of(installedSame, installedOther));

        Assertions.assertEquals(List.of(Path.of("dev", "external-one"), Path.of("plugins", "external-two")), result.stream()
                .map(DiscoveredPlugin::source)
                .toList());
    }

    @Test
    void developerFolderWithoutABackendStillReplacesTheInstalledBackend()
    {
        // A frontend-only developer folder: the installed backend must not load next to the developer frontend
        DiscoveredPlugin installed = discovered("external.one", Path.of("plugins", "external-one"));

        Assertions.assertEquals(List.of(), BackendRunnerModule.preferDevelopmentPlugins(List.of(), Set.of("external.one"), List.of(installed)));
    }

    @Test
    void parsesDeveloperPluginFoldersSeparatedLikeThePlatformPath()
    {
        String value = String.join(java.io.File.pathSeparator, "first", " ", "second ");

        Assertions.assertEquals(List.of(Path.of("first"), Path.of("second")), BackendRunnerModule.parseDevPluginDirs(value));
        Assertions.assertEquals(List.of(), BackendRunnerModule.parseDevPluginDirs(null));
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
