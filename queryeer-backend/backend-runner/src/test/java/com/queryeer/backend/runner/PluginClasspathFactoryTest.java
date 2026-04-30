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

class PluginClasspathFactoryTest
{
    @TempDir
    Path tempDir;

    @Test
    void resolvesBackendApiTypesFromParentClassLoader() throws Exception
    {
        PluginClasspathFactory factory = new PluginClasspathFactory();

        try (var classLoader = factory.createClassLoader(tempDir, getClass().getClassLoader()))
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

        PluginClasspathFactory factory = new PluginClasspathFactory();
        try (var classLoader = factory.createClassLoader(classesRoot, getClass().getClassLoader()))
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
