package com.queryeer.backend.runner;

import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

final class PluginClassLoaderFactory
{
    private static final List<String> PARENT_FIRST_PREFIXES = List.of("java.", "javax.", "jdk.", "sun.", "com.queryeer.backend.api.", "com.queryeer.backend.contract.");

    private final SharedClassLoader sharedLoader;

    PluginClassLoaderFactory(SharedClassLoader sharedLoader)
    {
        this.sharedLoader = sharedLoader;
    }

    URLClassLoader createClassLoader(Path source, PluginManifest manifest)
    {
        List<URL> urls = new ArrayList<>();
        try
        {
            if (manifest.backend() != null
                    && manifest.backend()
                            .classpath() != null)
            {
                buildManifestClasspath(source, manifest.backend()
                        .classpath(), urls);
                return new ParentAwarePluginClassLoader(urls.toArray(URL[]::new), sharedLoader);
            }

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

        return new ParentAwarePluginClassLoader(urls.toArray(URL[]::new), sharedLoader);
    }

    private void buildManifestClasspath(Path source, PluginManifest.Classpath classpath, List<URL> urls) throws IOException
    {
        if (!Files.isDirectory(source))
        {
            throw new PluginDiscoveryException("backend.classpath is only supported for directory plugin sources: " + source);
        }

        if (classpath.include() == null
                || classpath.include()
                        .isEmpty())
        {
            throw new PluginDiscoveryException("backend.classpath.include must contain at least one entry for plugin source: " + source);
        }

        Path root = source.resolve(classpath.root())
                .normalize();
        if (!Files.exists(root)
                || !Files.isDirectory(root))
        {
            throw new PluginDiscoveryException("backend.classpath.root does not exist or is not a directory: " + root + " (source: " + source + ")");
        }

        for (String entry : classpath.include())
        {
            if (entry == null
                    || entry.isBlank())
            {
                continue;
            }
            if (entry.startsWith("@"))
            {
                Path listFile = root.resolve(entry.substring(1))
                        .normalize();
                addClasspathEntriesFromList(root, listFile, urls, source);
                continue;
            }

            addClasspathEntry(root, entry, urls, source);
        }
    }

    private void addClasspathEntriesFromList(Path root, Path listFile, List<URL> urls, Path source) throws IOException
    {
        if (!Files.exists(listFile)
                || !Files.isRegularFile(listFile))
        {
            throw new PluginDiscoveryException("Classpath list file not found: " + listFile + " (source: " + source + ")");
        }

        List<String> lines = Files.readAllLines(listFile, StandardCharsets.UTF_8);
        for (String line : lines)
        {
            String candidate = line == null ? ""
                    : line.trim();
            if (candidate.isEmpty()
                    || candidate.startsWith("#"))
            {
                continue;
            }
            addClasspathEntry(root, candidate, urls, source);
        }
    }

    private void addClasspathEntry(Path root, String candidate, List<URL> urls, Path source) throws IOException
    {
        if (containsGlob(candidate))
        {
            addGlobEntries(root, candidate, urls, source);
            return;
        }

        Path path = Path.of(candidate);
        Path resolved = path.isAbsolute() ? path
                : root.resolve(path);
        Path normalized = resolved.normalize();

        if (!Files.exists(normalized))
        {
            throw new PluginDiscoveryException("Classpath entry not found: " + normalized + " (source: " + source + ")");
        }

        urls.add(normalized.toUri()
                .toURL());
    }

    private void addGlobEntries(Path root, String pattern, List<URL> urls, Path source) throws IOException
    {
        List<Path> matches = new ArrayList<>();
        try (DirectoryStream<Path> stream = Files.newDirectoryStream(root, pattern))
        {
            for (Path path : stream)
            {
                matches.add(path);
            }
        }

        if (matches.isEmpty())
        {
            throw new PluginDiscoveryException("Classpath glob did not match any files: " + pattern + " (root: " + root + ", source: " + source + ")");
        }

        for (Path match : matches)
        {
            urls.add(match.toUri()
                    .toURL());
        }
    }

    private boolean containsGlob(String candidate)
    {
        return candidate.indexOf('*') >= 0
                || candidate.indexOf('?') >= 0;
    }

    SharedClassLoader sharedLoader()
    {
        return sharedLoader;
    }

    static final class ParentAwarePluginClassLoader extends URLClassLoader
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
