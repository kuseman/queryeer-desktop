package com.queryeer.backend.runner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.core.BackendPlatformServices;
import com.queryeer.backend.core.security.SecuritySession;

/** Dependencies as plain ids or as {@code { id, version }}, and the version built-in plugins report. */
class PluginManifestDependenciesTest
{
    @TempDir
    Path tempDir;

    @Test
    void readsPlainAndVersionedDependencies() throws IOException
    {
        PluginManifest manifest = load("""
                "dependencies": ["queryengine.runtime.sql-parser", { "id": "queryengine.jdbc", "version": "^0.20.0" }, { "id": "other" }]
                """);

        assertEquals(List.of("queryengine.runtime.sql-parser", "queryengine.jdbc", "other"), manifest.dependenciesOrEmpty());
        assertEquals(Map.of("queryengine.jdbc", "^0.20.0"), manifest.dependencyVersions());

        PluginDescriptor descriptor = new PluginManifestBackedPlugin(manifest, (com.queryeer.backend.api.BackendPlugin) null).descriptor();
        assertEquals(List.of("queryengine.runtime.sql-parser", "queryengine.jdbc", "other"), descriptor.dependencies());
        assertEquals(Map.of("queryengine.jdbc", "^0.20.0"), descriptor.dependencyVersions());
    }

    @Test
    void splitsRequiredAndOptionalDependenciesAndKeepsBothRanges() throws IOException
    {
        PluginManifest manifest = load("""
                "dependencies": [{ "id": "queryengine.jdbc", "version": "^0.21.0" }, { "id": "queryengine.payloadbuilder", "version": "^0.21.0", "optional": true }]
                """);

        PluginDescriptor descriptor = new PluginManifestBackedPlugin(manifest, (com.queryeer.backend.api.BackendPlugin) null).descriptor();
        assertEquals(List.of("queryengine.jdbc"), descriptor.dependencies());
        assertEquals(List.of("queryengine.payloadbuilder"), descriptor.optionalDependencies());
        assertEquals(Map.of("queryengine.jdbc", "^0.21.0", "queryengine.payloadbuilder", "^0.21.0"), descriptor.dependencyVersions());
    }

    @Test
    void readsAManifestWithoutDependencies() throws IOException
    {
        PluginManifest manifest = load("");

        assertEquals(List.of(), manifest.dependenciesOrEmpty());
        assertEquals(Map.of(), manifest.dependencyVersions());
    }

    @Test
    void rejectsAnInvalidRange()
    {
        PluginDiscoveryException error = assertThrows(PluginDiscoveryException.class, () -> load("""
                "dependencies": [{ "id": "queryengine.jdbc", "version": "^0.x.1" }]
                """));
        assertTrue(error.getMessage()
                .contains("Invalid version range for dependency queryengine.jdbc"), error.getMessage());
    }

    @Test
    void rejectsAMisspeltKey()
    {
        // The shared mapper ignores unknown properties; without this check the version range would be dropped silently
        PluginDiscoveryException error = assertThrows(PluginDiscoveryException.class, () -> load("""
                "dependencies": [{ "id": "queryengine.jdbc", "versoin": "^0.20.0" }]
                """));
        assertTrue(error.getMessage()
                .contains("unknown key(s) [versoin]"), error.getMessage());
    }

    @Test
    void rejectsAVersionThatIsNotAString()
    {
        assertThrows(PluginDiscoveryException.class, () -> load("""
                "dependencies": [{ "id": "queryengine.jdbc", "version": 20 }]
                """));
        assertThrows(PluginDiscoveryException.class, () -> load("""
                "dependencies": [42]
                """));
    }

    @Test
    void rejectsADependencyWithoutAnId()
    {
        assertThrows(PluginDiscoveryException.class, () -> load("""
                "dependencies": [{ "version": "^0.20.0" }]
                """));
    }

    @Test
    void rejectsADuplicateDependency()
    {
        assertThrows(PluginDiscoveryException.class, () -> load("""
                "dependencies": ["queryengine.jdbc", { "id": "queryengine.jdbc", "version": "^0.20.0" }]
                """));
    }

    @Test
    void builtinPluginsReportTheBackendVersion() throws IOException
    {
        Path builtinsDir = tempDir.resolve("builtin");
        Path pluginDir = builtinsDir.resolve("queryengine.jdbc");
        Files.createDirectories(pluginDir);
        Files.writeString(pluginDir.resolve("plugin.json"), manifestJson(""), StandardCharsets.UTF_8);

        PluginClassLoaderFactory classLoaderFactory = new PluginClassLoaderFactory(new SharedClassLoader(List.of(), getClass().getClassLoader()));
        PluginDiscoveryService discoveryService = new PluginDiscoveryService(BackendPlatformServices.fileBased(Map.of(), new SecuritySession()), classLoaderFactory);

        List<DiscoveredPlugin> discovered = new BuiltinPluginDiscovery(discoveryService, builtinsDir, "0.20.0-SNAPSHOT").discover();

        assertEquals("0.20.0-SNAPSHOT", discovered.get(0)
                .manifest()
                .version());
        assertEquals("0.20.0-SNAPSHOT", discovered.get(0)
                .plugin()
                .descriptor()
                .version());
    }

    @Test
    void theBuildWritesTheBackendVersion()
    {
        String version = BackendVersion.get();
        assertTrue(version != null
                && version.matches("\\d+\\.\\d+\\.\\d+.*"), "backend version: " + version);
    }

    private PluginManifest load(String dependenciesProperty) throws IOException
    {
        Path pluginDir = Files.createTempDirectory(tempDir, "plugin");
        Files.writeString(pluginDir.resolve("plugin.json"), manifestJson(dependenciesProperty), StandardCharsets.UTF_8);
        return new PluginManifestLoader().load(pluginDir);
    }

    private static String manifestJson(String dependenciesProperty)
    {
        return """
                {
                  "schemaVersion": 1,
                  "id": "queryengine.jdbc",
                  "name": "JDBC Query Engine",
                  "version": "0.1.0",
                  %s
                  "backend": {
                    "entrypointClass": "com.queryeer.backend.runner.PluginFactoryTest$TestEntrypointPlugin"
                  }
                }
                """.formatted(dependenciesProperty.isBlank() ? ""
                : dependenciesProperty.strip() + ",");
    }
}
