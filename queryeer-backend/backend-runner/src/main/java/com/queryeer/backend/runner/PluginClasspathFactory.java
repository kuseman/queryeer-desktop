package com.queryeer.backend.runner;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

final class PluginClasspathFactory
{
    private static final List<String> PARENT_FIRST_PREFIXES = List.of("java.", "javax.", "jdk.", "sun.", "com.queryeer.backend.api.", "com.queryeer.backend.contract.");

    URLClassLoader createClassLoader(Path source, ClassLoader parent)
    {
        List<URL> urls = new ArrayList<>();
        try
        {
            if (Files.isDirectory(source))
            {
                urls.add(source.toUri()
                        .toURL());
                Path libDir = source.resolve("lib");
                if (Files.exists(libDir)
                        && Files.isDirectory(libDir))
                {
                    try (DirectoryStream<Path> stream = Files.newDirectoryStream(libDir, "*.jar"))
                    {
                        for (Path jar : stream)
                        {
                            urls.add(jar.toUri()
                                    .toURL());
                        }
                    }
                }
            }
            else
            {
                urls.add(source.toUri()
                        .toURL());
            }
        }
        catch (IOException e)
        {
            throw new PluginDiscoveryException("Failed to build classpath for plugin source: " + source, e);
        }

        return new ParentAwarePluginClassLoader(urls.toArray(URL[]::new), parent);
    }

    private static final class ParentAwarePluginClassLoader extends URLClassLoader
    {
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
                    loaded = loadClassInternal(name);
                }
                if (resolve)
                {
                    resolveClass(loaded);
                }
                return loaded;
            }
        }

        private Class<?> loadClassInternal(String name) throws ClassNotFoundException
        {
            if (isParentFirst(name))
            {
                return super.loadClass(name, false);
            }

            try
            {
                return findClass(name);
            }
            catch (ClassNotFoundException ignored)
            {
                return super.loadClass(name, false);
            }
        }

        private boolean isParentFirst(String name)
        {
            return PARENT_FIRST_PREFIXES.stream()
                    .anyMatch(name::startsWith);
        }
    }
}
