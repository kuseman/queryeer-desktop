package com.queryeer.backend.runner;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.api.BackendPlugin;

class PluginClassLoaderFactoryTest
{
    @TempDir
    Path tempDir;

    private PluginClassLoaderFactory createFactory()
    {
        return new PluginClassLoaderFactory(new SharedClassLoader(List.of(), getClass().getClassLoader()));
    }

    @Test
    void resolvesBackendApiTypesFromParentClassLoader() throws Exception
    {
        PluginClassLoaderFactory factory = createFactory();
        PluginManifest manifest = pluginManifest(null);

        try (var classLoader = factory.createClassLoader(tempDir, manifest))
        {
            Class<?> loaded = classLoader.loadClass(BackendPlugin.class.getName());

            Assertions.assertSame(BackendPlugin.class, loaded);
        }
    }

    @Test
    void resolvesNonApiTypesChildFirstWhenShadowed() throws Exception
    {
        Path classesRoot = tempDir.resolve("classes");
        compilePluginClass(classesRoot, "com.queryeer.backend.runner.testsupport.ShadowedType", "plugin");

        PluginClassLoaderFactory factory = createFactory();
        PluginManifest manifest = pluginManifest(new PluginManifest.Classpath(".", List.of(".")));
        try (var classLoader = factory.createClassLoader(classesRoot, manifest))
        {
            Class<?> loaded = classLoader.loadClass("com.queryeer.backend.runner.testsupport.ShadowedType");
            Object instance = loaded.getDeclaredConstructor()
                    .newInstance();
            Object source = loaded.getMethod("source")
                    .invoke(instance);

            Assertions.assertEquals("plugin", source);
            Assertions.assertSame(classLoader, loaded.getClassLoader());
        }
    }

    @Test
    void resolvesClasspathEntriesFromDepsList() throws Exception
    {
        Path sourceDir = tempDir.resolve("plugin");
        Files.createDirectories(sourceDir);
        Path classesDir = sourceDir.resolve("classes");
        Path depJar = sourceDir.resolve("dep.jar");
        compilePluginClass(classesDir, "dev.sample.PluginType", "plugin");
        Files.writeString(depJar, "not-a-real-jar", StandardCharsets.UTF_8);
        Files.writeString(sourceDir.resolve("deps-list.txt"), depJar.toString(), StandardCharsets.UTF_8);

        PluginManifest manifest = pluginManifest(new PluginManifest.Classpath(".", List.of("classes", "@deps-list.txt")));
        PluginClassLoaderFactory factory = createFactory();
        try (var classLoader = factory.createClassLoader(sourceDir, manifest))
        {
            Class<?> loaded = classLoader.loadClass("dev.sample.PluginType");
            Assertions.assertSame(classLoader, loaded.getClassLoader());
        }
    }

    @Test
    void failsWhenDepsListEntryIsMissing() throws Exception
    {
        Path sourceDir = tempDir.resolve("plugin");
        Files.createDirectories(sourceDir);
        Path missingJar = sourceDir.resolve("missing.jar");
        Files.writeString(sourceDir.resolve("deps-list.txt"), missingJar.toString(), StandardCharsets.UTF_8);

        PluginManifest manifest = pluginManifest(new PluginManifest.Classpath(".", List.of("@deps-list.txt")));
        PluginClassLoaderFactory factory = createFactory();

        PluginDiscoveryException error = Assertions.assertThrows(PluginDiscoveryException.class, () -> factory.createClassLoader(sourceDir, manifest));
        Assertions.assertTrue(error.getMessage()
                .contains("Classpath entry not found"));
    }

    @Test
    void resolvesGlobClasspathEntries() throws Exception
    {
        Path sourceDir = tempDir.resolve("plugin");
        Path libDir = sourceDir.resolve("lib");
        Files.createDirectories(libDir);
        Files.writeString(libDir.resolve("dep-a.jar"), "a", StandardCharsets.UTF_8);
        Files.writeString(libDir.resolve("dep-b.jar"), "b", StandardCharsets.UTF_8);

        PluginManifest manifest = pluginManifest(new PluginManifest.Classpath("lib", List.of("*.jar")));
        PluginClassLoaderFactory factory = createFactory();
        try (var classLoader = factory.createClassLoader(sourceDir, manifest))
        {
            Assertions.assertNotNull(classLoader);
        }
    }

    private PluginManifest pluginManifest(PluginManifest.Classpath classpath)
    {
        return new PluginManifest(1, "dev.plugin", "Dev Plugin", "0.1.0", new PluginManifest.BackendTarget("dev.sample.Plugin", null, classpath, "17"), null, List.of(), List.of(), List.of(), null,
                null);
    }

    private void compilePluginClass(Path classesRoot, String fqcn, String sourceValue) throws IOException
    {
        Path sourceRoot = tempDir.resolve("src");
        Path sourceFile = sourceRoot.resolve(fqcn.replace('.', '/') + ".java");
        Files.createDirectories(sourceFile.getParent());
        Files.createDirectories(classesRoot);

        String packageName = fqcn.substring(0, fqcn.lastIndexOf('.'));
        String simpleName = fqcn.substring(fqcn.lastIndexOf('.') + 1);
        String source = "package " + packageName + ";\n" + "public final class " + simpleName + " {\n" + "  public String source() { return \"" + sourceValue + "\"; }\n" + "}\n";
        Files.writeString(sourceFile, source, StandardCharsets.UTF_8);

        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null)
        {
            throw new IllegalStateException("System Java compiler is unavailable");
        }

        int exitCode = compiler.run(null, null, null, List.of("-d", classesRoot.toString(), sourceFile.toString())
                .toArray(String[]::new));
        if (exitCode != 0)
        {
            throw new IllegalStateException("Compilation failed for " + fqcn);
        }
    }
}
