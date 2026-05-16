package com.queryeer.backend.runner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.core.BackendPlatformServices;

class PluginManifestDiscoveryTest
{
    @TempDir
    Path tempDir;

    @Test
    void discoversFolderPluginsWithManifest() throws IOException
    {
        Path pluginsDir = tempDir.resolve("plugins");
        Path pluginFolder = pluginsDir.resolve("example-plugin");
        Files.createDirectories(pluginFolder);

        String json = """
                {
                  "schemaVersion": 1,
                  "id": "example.plugin",
                  "name": "Example Plugin",
                  "version": "1.0.0",
                  "backend": {
                    "entrypointClass": "com.example.DoesNotMatter"
                  },
                  "dependencies": [],
                  "providesCapabilities": ["queryengine.execute"],
                  "requiredCapabilities": []
                }
                """;
        Files.writeString(pluginFolder.resolve("plugin.json"), json, StandardCharsets.UTF_8);

        PluginSourceExplorer explorer = new PluginSourceExplorer();
        PluginManifestLoader loader = new PluginManifestLoader();

        List<Path> sources = explorer.discoverPluginSources(pluginsDir);
        Assertions.assertEquals(1, sources.size());

        PluginManifest manifest = loader.load(sources.get(0));
        Assertions.assertEquals("example.plugin", manifest.id());
        Assertions.assertEquals("Example Plugin", manifest.name());
        Assertions.assertEquals("com.example.DoesNotMatter", manifest.backend()
                .entrypointClass());
    }

    @Test
    void throwsForFolderWithoutManifest() throws IOException
    {
        Path pluginsDir = tempDir.resolve("plugins");
        Path pluginFolder = pluginsDir.resolve("broken-plugin");
        Files.createDirectories(pluginFolder);

        PluginManifestLoader loader = new PluginManifestLoader();

        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> loader.load(pluginFolder));
        Assertions.assertTrue(error.getMessage()
                .contains("Missing plugin manifest"));
    }

    @Test
    void throwsForDuplicatePluginIdsAcrossSources() throws IOException
    {
        Path pluginsDir = tempDir.resolve("plugins");
        Path pluginFolderA = pluginsDir.resolve("plugin-a");
        Path pluginFolderB = pluginsDir.resolve("plugin-b");
        Files.createDirectories(pluginFolderA);
        Files.createDirectories(pluginFolderB);

        String duplicateManifestA = """
                {
                  "schemaVersion": 1,
                  "id": "duplicate.plugin",
                  "name": "Duplicate Plugin A",
                  "version": "1.0.0",
                  "frontend": {
                    "entryModule": "dist/index-a.mjs"
                  }
                }
                """;
        String duplicateManifestB = """
                {
                  "schemaVersion": 1,
                  "id": "duplicate.plugin",
                  "name": "Duplicate Plugin B",
                  "version": "1.0.1",
                  "frontend": {
                    "entryModule": "dist/index.mjs"
                  }
                }
                """;
        Files.writeString(pluginFolderA.resolve("plugin.json"), duplicateManifestA, StandardCharsets.UTF_8);
        Files.writeString(pluginFolderB.resolve("plugin.json"), duplicateManifestB, StandardCharsets.UTF_8);

        PluginClassLoaderFactory classLoaderFactory = new PluginClassLoaderFactory(new SharedClassLoader(List.of(), getClass().getClassLoader()));
        PluginDiscoveryService service = new PluginDiscoveryService(BackendPlatformServices.defaultServices(), classLoaderFactory);
        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> service.discoverFromPath(pluginsDir.toString()));

        Assertions.assertTrue(error.getMessage()
                .contains("Duplicate plugin id discovered: duplicate.plugin"));
    }

    @Test
    void throwsForBackendClasspathWithoutIncludeEntries() throws IOException
    {
        Path pluginsDir = tempDir.resolve("plugins");
        Path pluginFolder = pluginsDir.resolve("broken-classpath");
        Files.createDirectories(pluginFolder);

        String json = """
                {
                  "schemaVersion": 1,
                  "id": "broken.classpath",
                  "name": "Broken Classpath",
                  "version": "1.0.0",
                  "backend": {
                    "entrypointClass": "com.example.DoesNotMatter",
                    "classpath": {
                      "root": ".",
                      "include": []
                    }
                  }
                }
                """;
        Files.writeString(pluginFolder.resolve("plugin.json"), json, StandardCharsets.UTF_8);

        PluginManifestLoader loader = new PluginManifestLoader();
        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> loader.load(pluginFolder));
        Assertions.assertTrue(error.getMessage()
                .contains("backend.classpath.include"));
    }

    @Test
    void loadsSharedRuntimeManifest() throws IOException
    {
        Path pluginFolder = tempDir.resolve("runtime-plugin");
        Files.createDirectories(pluginFolder);

        String json = """
                {
                  "schemaVersion": 1,
                  "id": "queryengine.runtime.jdbc-foundation",
                  "name": "JDBC Foundation Runtime",
                  "version": "1.0.0",
                  "backend": {
                    "entrypointClass": "com.example.RuntimePlugin"
                  },
                  "runtime": {
                    "shared": {
                      "parentFirstPackagePrefixes": ["com.queryeer.backend.queryengine.jdbc."],
                      "nativeLibraries": []
                    }
                  }
                }
                """;
        Files.writeString(pluginFolder.resolve("plugin.json"), json, StandardCharsets.UTF_8);

        PluginManifest manifest = new PluginManifestLoader().load(pluginFolder);

        Assertions.assertEquals(List.of("com.queryeer.backend.queryengine.jdbc."), manifest.runtime()
                .shared()
                .parentFirstPackagePrefixes());
    }

    @Test
    void rejectsUnsafeSharedRuntimePrefix() throws IOException
    {
        Path pluginFolder = tempDir.resolve("runtime-plugin");
        Files.createDirectories(pluginFolder);

        String json = """
                {
                  "schemaVersion": 1,
                  "id": "bad.runtime",
                  "name": "Bad Runtime",
                  "version": "1.0.0",
                  "backend": {
                    "entrypointClass": "com.example.RuntimePlugin"
                  },
                  "runtime": {
                    "shared": {
                      "parentFirstPackagePrefixes": ["com."]
                    }
                  }
                }
                """;
        Files.writeString(pluginFolder.resolve("plugin.json"), json, StandardCharsets.UTF_8);

        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> new PluginManifestLoader().load(pluginFolder));

        Assertions.assertTrue(error.getMessage()
                .contains("Invalid runtime.shared.parentFirstPackagePrefixes"));
    }
}
