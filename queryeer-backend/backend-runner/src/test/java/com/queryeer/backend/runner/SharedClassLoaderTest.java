package com.queryeer.backend.runner;

import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.contract.BackendEnvelope;

class SharedClassLoaderTest
{
    @TempDir
    Path tempDir;

    @Test
    void delegatesApiTypesToParentAppClassLoader() throws Exception
    {
        @SuppressWarnings("resource")
        SharedClassLoader sharedLoader = new SharedClassLoader(List.of(), getClass().getClassLoader());

        // API type should be resolved from parent (AppLoader), not from sharedLoader's own URLs
        Class<?> loaded = sharedLoader.loadClass(BackendPlugin.class.getName());

        Assertions.assertSame(BackendPlugin.class, loaded);
    }

    @Test
    void delegatesContractTypesToParentAppClassLoader() throws Exception
    {
        @SuppressWarnings("resource")
        SharedClassLoader sharedLoader = new SharedClassLoader(List.of(), getClass().getClassLoader());

        Class<?> loaded = sharedLoader.loadClass(BackendEnvelope.class.getName());

        Assertions.assertSame(BackendEnvelope.class, loaded);
    }

    @Test
    void delegatesJavaLangTypesToParentClassLoader() throws Exception
    {
        @SuppressWarnings("resource")
        SharedClassLoader sharedLoader = new SharedClassLoader(List.of(), getClass().getClassLoader());

        Class<?> loaded = sharedLoader.loadClass("java.lang.String");

        Assertions.assertSame(String.class, loaded);
    }

    @Test
    void closesCleanly() throws Exception
    {
        Path dummyJar = tempDir.resolve("dummy.jar");
        Files.writeString(dummyJar, "mock content");

        SharedClassLoader sharedLoader = new SharedClassLoader(List.of(dummyJar.toUri()
                .toURL()), getClass().getClassLoader());

        Assertions.assertDoesNotThrow(sharedLoader::close);
    }

    @Test
    void sharedLoaderHasAppClassLoaderAsParent()
    {
        @SuppressWarnings("resource")
        SharedClassLoader sharedLoader = new SharedClassLoader(List.of(), getClass().getClassLoader());

        Assertions.assertSame(getClass().getClassLoader(), sharedLoader.getParent());
    }

    @Test
    void pluginClassLoaderCanResolveDriverTypesThroughSharedLoader()
    {
        // Simulate the real hierarchy: AppCL → SharedCL → PluginCL
        ClassLoader appCL = getClass().getClassLoader();
        SharedClassLoader sharedLoader = new SharedClassLoader(List.of(), appCL);

        @SuppressWarnings("resource")
        ParentAwarePluginClassLoader pluginCL = new ParentAwarePluginClassLoader(new URL[0], sharedLoader);

        // PluginCL should resolve API types through SharedCL → AppCL
        Assertions.assertDoesNotThrow(() ->
        {
            Class<?> apiType = pluginCL.loadClass(BackendPlugin.class.getName());
            Assertions.assertSame(BackendPlugin.class, apiType);
        });
    }

    // Minimal parent-aware plugin classloader for testing the delegation chain
    private static final class ParentAwarePluginClassLoader extends java.net.URLClassLoader
    {
        private static final List<String> PARENT_FIRST_PREFIXES = List.of("java.", "javax.", "jdk.", "sun.", "com.queryeer.backend.api.", "com.queryeer.backend.contract.");

        ParentAwarePluginClassLoader(URL[] urls, ClassLoader parent)
        {
            super(urls, parent);
        }

        @Override
        protected Class<?> loadClass(String name, boolean resolve) throws ClassNotFoundException
        {
            synchronized (getClassLoadingLock(name))
            {
                Class<?> loaded = findLoadedClass(name);
                if (loaded == null)
                {
                    if (PARENT_FIRST_PREFIXES.stream()
                            .anyMatch(name::startsWith))
                    {
                        loaded = super.loadClass(name, false);
                    }
                    else
                    {
                        try
                        {
                            loaded = findClass(name);
                        }
                        catch (ClassNotFoundException ignored)
                        {
                            loaded = super.loadClass(name, false);
                        }
                    }
                }
                if (resolve)
                {
                    resolveClass(loaded);
                }
                return loaded;
            }
        }
    }
}
