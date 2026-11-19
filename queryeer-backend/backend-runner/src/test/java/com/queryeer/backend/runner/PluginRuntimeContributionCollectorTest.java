package com.queryeer.backend.runner;

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
    void collectsParentFirstPrefixes() throws Exception
    {
        Path source = tempDir.resolve("dialect-plugin");
        Files.createDirectories(source.resolve("classes"));
        PluginManifest manifest = new PluginManifest(1, "queryengine.jdbc.dialect.sqlserver", "SQL Server Dialect", "1.0.0",
                new PluginManifest.BackendTarget("example.Plugin", null, new PluginManifest.Classpath(".", List.of("classes"))), null, List.of(), List.of(), List.of(), null, null,
                new PluginManifest.RuntimeTarget(new PluginManifest.SharedRuntime(List.of("com.microsoft.sqlserver.jdbc."), List.of(), List.of())));

        PluginRuntimeContributionCollector.PluginRuntimeContributions contributions = new PluginRuntimeContributionCollector()
                .collect(List.of(new PluginRuntimeContributionCollector.ManifestSource(manifest, source)));

        Assertions.assertTrue(contributions.parentFirstPrefixes()
                .contains("com.microsoft.sqlserver.jdbc."));
        Assertions.assertEquals(List.of(), contributions.nativeLibraries());
    }
}
