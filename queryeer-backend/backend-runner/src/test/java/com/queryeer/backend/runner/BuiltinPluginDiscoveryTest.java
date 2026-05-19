package com.queryeer.backend.runner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.core.BackendPlatformServices;
import com.queryeer.backend.core.security.SecuritySession;

class BuiltinPluginDiscoveryTest
{
    @TempDir
    Path tempDir;

    @Test
    void discoversBuiltinPluginsFromManifestDirectory() throws IOException
    {
        Path builtinsDir = tempDir.resolve("plugins")
                .resolve("builtin");
        Path pluginDir = builtinsDir.resolve("queryengine.jdbc");
        Files.createDirectories(pluginDir);
        Files.writeString(pluginDir.resolve("plugin.json"), """
                {
                  "schemaVersion": 1,
                  "id": "queryengine.jdbc",
                  "name": "JDBC Query Engine",
                  "version": "0.1.0",
                  "backend": {
                    "entrypointClass": "com.queryeer.backend.runner.PluginFactoryTest$TestEntrypointPlugin"
                  },
                  "dependencies": [],
                  "providesCapabilities": ["queryengine.jdbc.connection"],
                  "requiredCapabilities": []
                }
                """, StandardCharsets.UTF_8);

        PluginClassLoaderFactory classLoaderFactory = new PluginClassLoaderFactory(new SharedClassLoader(List.of(), getClass().getClassLoader()));
        BackendPlatformServices platformServices = BackendPlatformServices.fileBased(Map.of(), new SecuritySession());
        PluginDiscoveryService discoveryService = new PluginDiscoveryService(platformServices, classLoaderFactory);
        BuiltinPluginDiscovery discovery = new BuiltinPluginDiscovery(discoveryService, builtinsDir);

        List<DiscoveredPlugin> discovered = discovery.discover();

        Assertions.assertEquals(List.of("queryengine.jdbc"), discovered.stream()
                .map(item -> item.manifest()
                        .id())
                .toList());
    }
}
