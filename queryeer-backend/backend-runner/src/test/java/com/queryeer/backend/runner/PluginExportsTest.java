package com.queryeer.backend.runner;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Plugins share classes through {@code backend.exports} and declared dependencies, tested with real plugin folders: an exporter ({@code test.api}) with an exported and an internal package, and
 * plugins that depend on it or not.
 */
class PluginExportsTest
{
    @TempDir
    Path tempDir;

    private PluginClassLoaderFactory factory;
    private Path exporterDir;
    private Path dependentDir;
    private Path strangerDir;

    @BeforeEach
    void compilePlugins() throws IOException
    {
        factory = new PluginClassLoaderFactory(new SharedClassLoader(List.of(), getClass().getClassLoader()));

        exporterDir = compile("exporter", Map.of("com/example/api/Api.java", """
                package com.example.api;
                public class Api { public static String origin() { return "exporter"; } }
                """, "com/example/internal/Hidden.java", """
                package com.example.internal;
                public class Hidden { }
                """));
        // Bundles its own copy of the exported class, which must not be used
        dependentDir = compile("dependent", Map.of("com/example/api/Api.java", """
                package com.example.api;
                public class Api { public static String origin() { return "dependent's copy"; } }
                """, "com/example/dependent/Uses.java", """
                package com.example.dependent;
                public class Uses { public static String origin() { return com.example.api.Api.origin(); } }
                """));
        strangerDir = compile("stranger", Map.of("com/example/stranger/Own.java", """
                package com.example.stranger;
                public class Own { }
                """));
    }

    @Test
    void aDependentLoadsExportedClassesFromTheExporter() throws Exception
    {
        URLClassLoader exporter = load(exporterDir, manifest("test.api", List.of("com.example.api."), List.of()));
        URLClassLoader dependent = load(dependentDir, manifest("test.dependent", List.of(), List.of("test.api")));

        Class<?> api = dependent.loadClass("com.example.api.Api");

        assertSame(exporter, api.getClassLoader());
        assertSame(exporter.loadClass("com.example.api.Api"), api);
        // Also when the dependent's own code links against it
        assertEquals("exporter", dependent.loadClass("com.example.dependent.Uses")
                .getMethod("origin")
                .invoke(null));
    }

    @Test
    void theOrderPluginsAreDiscoveredInDoesNotMatter() throws Exception
    {
        URLClassLoader dependent = load(dependentDir, manifest("test.dependent", List.of(), List.of("test.api")));
        URLClassLoader exporter = load(exporterDir, manifest("test.api", List.of("com.example.api."), List.of()));

        assertSame(exporter, dependent.loadClass("com.example.api.Api")
                .getClassLoader());
    }

    @Test
    void packagesThatAreNotExportedStayPrivate()
    {
        load(exporterDir, manifest("test.api", List.of("com.example.api."), List.of()));
        URLClassLoader dependent = load(dependentDir, manifest("test.dependent", List.of(), List.of("test.api")));

        assertThrows(ClassNotFoundException.class, () -> dependent.loadClass("com.example.internal.Hidden"));
    }

    @Test
    void withoutTheDependencyAPluginUsesItsOwnCopy() throws Exception
    {
        URLClassLoader exporter = load(exporterDir, manifest("test.api", List.of("com.example.api."), List.of()));
        URLClassLoader dependent = load(dependentDir, manifest("test.dependent", List.of(), List.of()));

        Class<?> api = dependent.loadClass("com.example.api.Api");

        assertSame(dependent, api.getClassLoader());
        assertNotSame(exporter.loadClass("com.example.api.Api"), api);
    }

    @Test
    void aMissingClassNamesTheDependencyToDeclare()
    {
        load(exporterDir, manifest("test.api", List.of("com.example.api."), List.of()));
        URLClassLoader stranger = load(strangerDir, manifest("test.stranger", List.of(), List.of()));

        ClassNotFoundException error = assertThrows(ClassNotFoundException.class, () -> stranger.loadClass("com.example.api.Api"));

        assertTrue(error.getMessage()
                .contains("plugin test.api exports it, but test.stranger does not declare a dependency on test.api"), error.getMessage());
    }

    @Test
    void anOptionalDependencysExportsAreVisibleOnlyWhileItIsInUse() throws Exception
    {
        URLClassLoader exporter = load(exporterDir, manifest("test.api", List.of("com.example.api."), List.of()));
        URLClassLoader optional = load(strangerDir, manifestWithOptional("test.optional", "test.api"));

        // Until the activation plan says the dependency is in use, its exports stay hidden
        ClassNotFoundException error = assertThrows(ClassNotFoundException.class, () -> optional.loadClass("com.example.api.Api"));
        assertTrue(error.getMessage()
                .contains("plugin test.api exports it, but it is an optional dependency of test.optional that isn't in use"), error.getMessage());

        ((PluginClassLoaderFactory.ParentAwarePluginClassLoader) optional).useOptionalDependencies(java.util.Set.of("test.api"));

        assertSame(exporter, optional.loadClass("com.example.api.Api")
                .getClassLoader());
    }

    @Test
    void readsOptionalFromADependencyEntry()
    {
        PluginManifest.Dependency optional = PluginManifest.Dependency.of(Map.of("id", "queryengine.payloadbuilder", "version", "^0.21.0", "optional", true));
        PluginManifest.Dependency required = PluginManifest.Dependency.of(Map.of("id", "queryengine.jdbc"));
        PluginManifest.Dependency invalid = PluginManifest.Dependency.of(Map.of("id", "x", "optional", "yes"));

        assertTrue(optional.optional());
        assertEquals("^0.21.0", optional.version());
        assertEquals(null, optional.problem());
        assertEquals(false, required.optional());
        assertEquals("optional must be true or false", invalid.problem());
    }

    @Test
    void anExportedClassTheExporterLacksIsAnError()
    {
        load(exporterDir, manifest("test.api", List.of("com.example.api."), List.of()));
        URLClassLoader dependent = load(dependentDir, manifest("test.dependent", List.of(), List.of("test.api")));

        ClassNotFoundException error = assertThrows(ClassNotFoundException.class, () -> dependent.loadClass("com.example.api.Missing"));

        assertTrue(error.getMessage()
                .contains("plugin test.api exports the package to test.dependent, but has no such class"), error.getMessage());
    }

    @Test
    void exportsAreNotPassedOn() throws Exception
    {
        // test.middle depends on test.api, and test.top depends only on test.middle: test.top does not see test.api's exports
        load(exporterDir, manifest("test.api", List.of("com.example.api."), List.of()));
        load(strangerDir, manifest("test.middle", List.of("com.example.stranger."), List.of("test.api")));
        URLClassLoader top = load(compile("top", Map.of("com/example/top/Top.java", "package com.example.top; public class Top { }")), manifest("test.top", List.of(), List.of("test.middle")));

        assertThrows(ClassNotFoundException.class, () -> top.loadClass("com.example.api.Api"));
    }

    @Test
    void validationRejectsBroadOrHostExports() throws IOException
    {
        for (String prefix : List.of("com.", "org.", "com.example.api", "java.sql.", "com.queryeer.backend.api.", "com.queryeer.", "a..b."))
        {
            Path pluginDir = Files.createTempDirectory(tempDir, "invalid");
            Files.writeString(pluginDir.resolve("plugin.json"), """
                    {
                      "schemaVersion": 1, "id": "test.invalid", "name": "Invalid", "version": "1.0.0",
                      "backend": { "entrypointClass": "com.example.Plugin", "exports": ["%s"] }
                    }
                    """.formatted(prefix), StandardCharsets.UTF_8);
            assertThrows(PluginDiscoveryException.class, () -> new PluginManifestLoader().load(pluginDir), prefix);
        }
    }

    @Test
    void validationAcceptsAPluginPackage() throws IOException
    {
        Path pluginDir = Files.createTempDirectory(tempDir, "valid");
        Files.writeString(pluginDir.resolve("plugin.json"), """
                {
                  "schemaVersion": 1, "id": "test.valid", "name": "Valid", "version": "1.0.0",
                  "backend": { "entrypointClass": "com.example.Plugin", "exports": ["com.example.api.", "com.queryeer.backend.queryengine.jdbc.", "org.treesitter."] }
                }
                """, StandardCharsets.UTF_8);

        assertEquals(List.of("com.example.api.", "com.queryeer.backend.queryengine.jdbc.", "org.treesitter."), new PluginManifestLoader().load(pluginDir)
                .backend()
                .exportsOrEmpty());
    }

    @Test
    void anUnpublishedExporterServesNothing()
    {
        // A disabled plugin gets a class loader during discovery, but its exports are never published
        factory.createClassLoader(exporterDir, manifest("test.api", List.of("com.example.api."), List.of()));
        URLClassLoader stranger = load(strangerDir, manifest("test.stranger", List.of(), List.of("test.api")));

        assertThrows(ClassNotFoundException.class, () -> stranger.loadClass("com.example.api.Api"));
    }

    @Test
    void entrypointsAreCreatedAtActivationNotAtDiscovery() throws Exception
    {
        int[] created = { 0 };
        PluginManifestBackedPlugin plugin = new PluginManifestBackedPlugin(manifest("test.lazy", List.of(), List.of()), () ->
        {
            created[0]++;
            return (context, descriptor) ->
            {
            };
        });

        assertEquals("test.lazy", plugin.descriptor()
                .id());
        plugin.deactivate();
        assertEquals(0, created[0]);

        plugin.activate(null, plugin.descriptor());
        plugin.withManifest(manifest("test.lazy", List.of(), List.of()))
                .activate(null, plugin.descriptor());
        assertEquals(1, created[0]);
    }

    @Test
    void theSharedLoaderDefinesItsOwnNativeLibraryLoader()
    {
        SharedClassLoader shared = new SharedClassLoader(List.of(), getClass().getClassLoader());

        Class<?> loader = shared.nativeLibraryLoader();

        // Libraries loaded through it are bound to the shared loader, where libShared's drivers live
        assertSame(shared, loader.getClassLoader());
        assertNotSame(SharedNativeLibraryLoader.class, loader);
        assertSame(loader, shared.nativeLibraryLoader());
    }

    /** A plugin's class loader, with its exports published, as for a plugin that discovery keeps. */
    private URLClassLoader load(Path dir, PluginManifest manifest)
    {
        URLClassLoader loader = factory.createClassLoader(dir, manifest);
        factory.publishExports(manifest.id(), loader);
        return loader;
    }

    private static PluginManifest manifest(String id, List<String> exports, List<String> dependencies)
    {
        return new PluginManifest(1, id, id, "1.0.0", new PluginManifest.BackendTarget("com.example.Plugin", null, null, exports), null, dependencies.stream()
                .map(dependency -> new PluginManifest.Dependency(dependency, null))
                .toList(), List.of(), List.of(), null, null, null);
    }

    private static PluginManifest manifestWithOptional(String id, String optionalDependency)
    {
        return new PluginManifest(1, id, id, "1.0.0", new PluginManifest.BackendTarget("com.example.Plugin", null, null, List.of()), null,
                List.of(new PluginManifest.Dependency(optionalDependency, null, true)), List.of(), List.of(), null, null, null);
    }

    /** Compiles the sources into {@code <name>/} (as a plugin folder's root, which the class loader factory puts on the classpath). */
    private Path compile(String name, Map<String, String> sources) throws IOException
    {
        Path sourceDir = tempDir.resolve(name + "-src");
        Path classesDir = tempDir.resolve(name);
        Files.createDirectories(classesDir);
        List<String> args = new ArrayList<>(List.of("-d", classesDir.toString()));
        for (Map.Entry<String, String> source : sources.entrySet())
        {
            Path file = sourceDir.resolve(source.getKey());
            Files.createDirectories(file.getParent());
            Files.writeString(file, source.getValue(), StandardCharsets.UTF_8);
            args.add(file.toString());
        }
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        int result = compiler.run(null, null, null, args.toArray(String[]::new));
        if (result != 0)
        {
            throw new IllegalStateException("Compilation failed for " + name);
        }
        return classesDir;
    }
}
