package com.queryeer.backend.runner;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PluginRuntimeContributionCollectorTest
{
    @TempDir
    Path tempDir;

    @Test
    void collectsParentFirstPrefixesAndSharedClasspath() throws Exception
    {
        Path source = tempDir.resolve("runtime-plugin");
        Path classes = source.resolve("classes");
        Path dep = source.resolve("dep.jar");
        Files.createDirectories(classes);
        Files.writeString(dep, "not-a-real-jar", StandardCharsets.UTF_8);
        Files.writeString(source.resolve("deps-list.txt"), dep.toString(), StandardCharsets.UTF_8);
        PluginManifest manifest = new PluginManifest(1, "queryengine.runtime.test", "Runtime Plugin", "1.0.0",
                new PluginManifest.BackendTarget("example.Plugin", null, new PluginManifest.Classpath(".", List.of("classes", "@deps-list.txt"))), null, List.of(), List.of(), List.of(), null, null,
                new PluginManifest.RuntimeTarget(new PluginManifest.SharedRuntime(List.of("com.example.shared."), List.of(), List.of())));

        PluginRuntimeContributionCollector.PluginRuntimeContributions contributions = new PluginRuntimeContributionCollector()
                .collect(List.of(new PluginRuntimeContributionCollector.ManifestSource(manifest, source)));

        Assertions.assertTrue(contributions.parentFirstPrefixes()
                .contains("com.example.shared."));
        Assertions.assertEquals(2, contributions.sharedClasspath()
                .size());
    }

    @Test
    void collectsSharedClasspathFromPackagedRuntimePluginLayout() throws Exception
    {
        Path source = tempDir.resolve("runtime-plugin-dist");
        Path lib = source.resolve("lib");
        Path pluginJar = lib.resolve("runtime-plugin.jar");
        Files.createDirectories(lib);
        Files.writeString(pluginJar, "not-a-real-jar", StandardCharsets.UTF_8);
        PluginManifest manifest = new PluginManifest(1, "queryengine.runtime.test", "Runtime Plugin", "1.0.0", new PluginManifest.BackendTarget("example.Plugin", null, null), null, List.of(),
                List.of(), List.of(), null, null, new PluginManifest.RuntimeTarget(new PluginManifest.SharedRuntime(List.of("com.example.shared."), List.of(), List.of())));

        PluginRuntimeContributionCollector.PluginRuntimeContributions contributions = new PluginRuntimeContributionCollector()
                .collect(List.of(new PluginRuntimeContributionCollector.ManifestSource(manifest, source)));

        Assertions.assertEquals(2, contributions.sharedClasspath()
                .size());
    }

    @Test
    void doesNotPromoteDialectPluginClasspathToSharedClasspath() throws Exception
    {
        Path source = tempDir.resolve("dialect-plugin");
        Path classes = source.resolve("classes");
        Files.createDirectories(classes);
        PluginManifest manifest = new PluginManifest(1, "queryengine.jdbc.dialect.sqlserver", "SQL Server Dialect", "1.0.0",
                new PluginManifest.BackendTarget("example.Plugin", null, new PluginManifest.Classpath(".", List.of("classes"))), null, List.of(), List.of(), List.of(), null, null,
                new PluginManifest.RuntimeTarget(new PluginManifest.SharedRuntime(List.of("com.microsoft.sqlserver.jdbc."), List.of(), List.of())));

        PluginRuntimeContributionCollector.PluginRuntimeContributions contributions = new PluginRuntimeContributionCollector()
                .collect(List.of(new PluginRuntimeContributionCollector.ManifestSource(manifest, source)));

        Assertions.assertTrue(contributions.parentFirstPrefixes()
                .contains("com.microsoft.sqlserver.jdbc."));
        Assertions.assertTrue(contributions.sharedClasspath()
                .isEmpty());
    }
}
