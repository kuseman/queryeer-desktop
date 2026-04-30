package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;

import com.queryeer.backend.api.PluginHostServices;

final class BuiltinPluginDiscovery
{
    private final PluginFactory pluginFactory;
    private final PluginHostServices hostServices;

    BuiltinPluginDiscovery(PluginFactory pluginFactory, PluginHostServices hostServices)
    {
        this.pluginFactory = pluginFactory;
        this.hostServices = hostServices;
    }

    List<DiscoveredPlugin> discover()
    {
        ClassLoader classLoader = BackendRunnerApp.class.getClassLoader();
        return builtinManifests().stream()
                .map(manifest ->
                {
                    Path source = Path.of("builtin", manifest.id());
                    return new DiscoveredPlugin(manifest, new PluginManifestBackedPlugin(manifest, pluginFactory.instantiate(manifest, classLoader, source, hostServices)), null, false, null);
                })
                .toList();
    }

    private List<PluginManifest> builtinManifests()
    {
        return List.of(
                new PluginManifest(1, "query.payloadbuilder", "Payloadbuilder Query Engine", "0.1.0",
                        new PluginManifest.BackendTarget("com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderBackendPlugin", null, null, "17"), null, List.of(),
                        List.of("queryengine.execute", "engine.invoke", "queryengine.payloadbuilder.catalog"), List.of(), null, null),
                new PluginManifest(1, "query.jdbc", "JDBC Query Engine", "0.1.0", new PluginManifest.BackendTarget("com.queryeer.backend.plugin.jdbc.JdbcBackendPlugin", null, null, "17"), null,
                        List.of(), List.of("queryengine.execute", "queryengine.jdbc.connection"), List.of(), null, null),
                new PluginManifest(1, "query.payloadbuilder.jdbc", "Payloadbuilder JDBC Bridge", "0.1.0",
                        new PluginManifest.BackendTarget("com.queryeer.backend.plugin.queryengine.payloadbuilder.jdbc.PayloadbuilderJdbcBackendPlugin", null, null, "17"), null,
                        List.of("query.payloadbuilder", "query.jdbc"), List.of("queryengine.payloadbuilder.jdbc.bridge"), List.of("queryengine.payloadbuilder.catalog", "queryengine.jdbc.connection"),
                        null, null));
    }
}
