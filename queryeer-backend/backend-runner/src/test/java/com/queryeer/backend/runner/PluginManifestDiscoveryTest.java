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
    void ignoresNonPluginFoldersDuringSourceDiscovery() throws IOException
    {
        Path pluginsDir = tempDir.resolve("plugins");
        Path stagingFolder = pluginsDir.resolve(".staging");
        Path pluginFolder = pluginsDir.resolve("example-plugin");
        Files.createDirectories(stagingFolder);
        Files.createDirectories(pluginFolder);
        Files.writeString(pluginFolder.resolve("plugin.json"), """
                {
                  "schemaVersion": 1,
                  "id": "example.plugin",
                  "name": "Example Plugin",
                  "version": "1.0.0",
                  "backend": {
                    "entrypointClass": "com.example.DoesNotMatter"
                  }
                }
                """, StandardCharsets.UTF_8);

        PluginSourceExplorer explorer = new PluginSourceExplorer();
        List<Path> sources = explorer.discoverPluginSources(pluginsDir);

        Assertions.assertEquals(List.of(pluginFolder), sources);
    }

    @Test
    void skipsAndReportsASecondPluginWithTheSameId() throws IOException
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
        BackendPlatformServices platformServices = BackendPlatformServices.fileBased(Map.of(), new SecuritySession());
        PluginDiscoveryService service = new PluginDiscoveryService(platformServices, classLoaderFactory);
        PluginDiscoveryService.DiscoveryResult result = service.discoverFromPath(pluginsDir.toString());

        Assertions.assertEquals(1, result.frontendPlugins()
                .size());
        Assertions.assertEquals(1, result.failures()
                .size());
        Assertions.assertEquals("duplicate.plugin", result.failures()
                .get(0)
                .pluginId());
        Assertions.assertTrue(result.failures()
                .get(0)
                .reason()
                .contains("Duplicate plugin id discovered: duplicate.plugin"));
    }

    @Test
    void aBrokenCopyDoesNotKeepAWorkingOneWithTheSameIdOut() throws IOException
    {
        Path pluginsDir = tempDir.resolve("plugins");
        Path broken = pluginsDir.resolve("a-broken");
        Path working = pluginsDir.resolve("b-working");
        Files.createDirectories(broken);
        Files.createDirectories(working);
        Files.writeString(broken.resolve("plugin.json"), """
                {
                  "schemaVersion": 1,
                  "id": "same.plugin",
                  "name": "Same",
                  "version": "1.0.0",
                  "dependencies": ["x.y", "x.y"],
                  "frontend": { "entryModule": "dist/index.mjs" }
                }
                """, StandardCharsets.UTF_8);
        Files.writeString(working.resolve("plugin.json"), """
                {
                  "schemaVersion": 1,
                  "id": "same.plugin",
                  "name": "Same",
                  "version": "1.0.1",
                  "frontend": { "entryModule": "dist/index.mjs" }
                }
                """, StandardCharsets.UTF_8);

        PluginClassLoaderFactory classLoaderFactory = new PluginClassLoaderFactory(new SharedClassLoader(List.of(), getClass().getClassLoader()));
        PluginDiscoveryService service = new PluginDiscoveryService(BackendPlatformServices.fileBased(Map.of(), new SecuritySession()), classLoaderFactory);
        PluginDiscoveryService.DiscoveryResult result = service.discoverFromPath(pluginsDir.toString());

        Assertions.assertEquals(List.of(working), result.frontendPlugins()
                .stream()
                .map(FrontendPluginResolver.ResolvedFrontendPlugin::source)
                .toList());
        Assertions.assertEquals(java.util.Set.of("same.plugin"), result.loadedIds());
        // The broken copy is still reported, by the id in its JSON
        Assertions.assertEquals(List.of("same.plugin"), result.failures()
                .stream()
                .map(PluginDiscoveryService.DiscoveryFailure::pluginId)
                .toList());
    }

    @Test
    void skipsAPluginWithAnInvalidManifestAndKeepsTheOthers() throws IOException
    {
        // E.g. a plugin installed under 0.19 that lists a dependency twice, which 0.20 refuses
        Path pluginsDir = tempDir.resolve("plugins");
        Path good = pluginsDir.resolve("good-plugin");
        Path invalid = pluginsDir.resolve("invalid-plugin");
        Path unreadable = pluginsDir.resolve("unreadable-plugin");
        Files.createDirectories(good);
        Files.createDirectories(invalid);
        Files.createDirectories(unreadable);
        Files.writeString(good.resolve("plugin.json"), """
                {
                  "schemaVersion": 1,
                  "id": "good.plugin",
                  "name": "Good",
                  "version": "1.0.0",
                  "frontend": { "entryModule": "dist/index.mjs" }
                }
                """, StandardCharsets.UTF_8);
        Files.writeString(invalid.resolve("plugin.json"), """
                {
                  "schemaVersion": 1,
                  "id": "invalid.plugin",
                  "name": "Invalid",
                  "version": "1.0.0",
                  "dependencies": ["good.plugin", "good.plugin"],
                  "frontend": { "entryModule": "dist/index.mjs" }
                }
                """, StandardCharsets.UTF_8);
        Files.writeString(unreadable.resolve("plugin.json"), "{ not json", StandardCharsets.UTF_8);

        PluginClassLoaderFactory classLoaderFactory = new PluginClassLoaderFactory(new SharedClassLoader(List.of(), getClass().getClassLoader()));
        PluginDiscoveryService service = new PluginDiscoveryService(BackendPlatformServices.fileBased(Map.of(), new SecuritySession()), classLoaderFactory);
        PluginDiscoveryService.DiscoveryResult result = service.discoverFromPath(pluginsDir.toString());

        Assertions.assertEquals(List.of("good.plugin"), result.frontendPlugins()
                .stream()
                .map(FrontendPluginResolver.ResolvedFrontendPlugin::pluginId)
                .toList());
        Assertions.assertEquals(List.of("invalid.plugin", "unreadable-plugin"), result.failures()
                .stream()
                .map(PluginDiscoveryService.DiscoveryFailure::pluginId)
                .sorted()
                .toList());
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
    void throwsForBlankBackendClasspathIncludeEntry() throws IOException
    {
        Path pluginFolder = tempDir.resolve("blank-classpath-include");
        Files.createDirectories(pluginFolder);
        Files.writeString(pluginFolder.resolve("plugin.json"), """
                {
                  "schemaVersion": 1,
                  "id": "blank.classpath.include",
                  "name": "Blank Classpath Include",
                  "version": "1.0.0",
                  "backend": {
                    "entrypointClass": "com.example.DoesNotMatter",
                    "classpath": { "root": ".", "include": ["   "] }
                  }
                }
                """, StandardCharsets.UTF_8);

        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> new PluginManifestLoader().load(pluginFolder));
        Assertions.assertTrue(error.getMessage()
                .contains("must not be blank"));
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
                      "nativeLibraries": [],
                      "sharedArtifacts": [
                        {
                          "pattern": "jdbc-driver-*.jar",
                          "required": false
                        }
                      ]
                    }
                  }
                }
                """;
        Files.writeString(pluginFolder.resolve("plugin.json"), json, StandardCharsets.UTF_8);

        PluginManifest manifest = new PluginManifestLoader().load(pluginFolder);

        Assertions.assertEquals(List.of("com.queryeer.backend.queryengine.jdbc."), manifest.runtime()
                .shared()
                .parentFirstPackagePrefixes());
        Assertions.assertEquals(List.of(new PluginManifest.SharedArtifact("jdbc-driver-*.jar", false)), manifest.runtime()
                .shared()
                .sharedArtifacts());
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

    @Test
    void skipsABackendThatNeedsANewerJava() throws IOException
    {
        Path pluginsDir = tempDir.resolve("plugins");
        Path future = pluginsDir.resolve("future-plugin");
        Files.createDirectories(future);
        Files.writeString(future.resolve("plugin.json"), """
                {
                  "schemaVersion": 1,
                  "id": "future.plugin",
                  "name": "Future",
                  "version": "1.0.0",
                  "backend": { "entrypointClass": "com.example.Plugin", "minJavaVersion": "999" }
                }
                """, StandardCharsets.UTF_8);

        PluginClassLoaderFactory classLoaderFactory = new PluginClassLoaderFactory(new SharedClassLoader(List.of(), getClass().getClassLoader()));
        PluginDiscoveryService service = new PluginDiscoveryService(BackendPlatformServices.fileBased(Map.of(), new SecuritySession()), classLoaderFactory);
        PluginDiscoveryService.DiscoveryResult result = service.discoverFromPath(pluginsDir.toString());

        Assertions.assertEquals(List.of(), result.backendPlugins());
        Assertions.assertEquals(1, result.failures()
                .size());
        Assertions.assertEquals("future.plugin", result.failures()
                .get(0)
                .pluginId());
        Assertions.assertEquals("Needs Java 999, but Queryeer's backend runs on Java " + Runtime.version()
                .feature(), result.failures()
                        .get(0)
                        .reason());
    }

    @Test
    void javaVersionProblemComparesFeatureVersions()
    {
        Assertions.assertNull(ManifestBackendPluginResolver.javaVersionProblem(null, 25));
        Assertions.assertNull(ManifestBackendPluginResolver.javaVersionProblem(" 25 ", 25));
        Assertions.assertNull(ManifestBackendPluginResolver.javaVersionProblem("21", 25));
        Assertions.assertEquals("Needs Java 26, but Queryeer's backend runs on Java 25", ManifestBackendPluginResolver.javaVersionProblem("26", 25));
        Assertions.assertEquals("backend.minJavaVersion must be a Java version such as \"25\", not \"25.0.1\"", ManifestBackendPluginResolver.javaVersionProblem("25.0.1", 25));
    }
}
