package com.queryeer.backend.runner;

import java.io.File;
import java.io.IOException;
import java.net.URL;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

final class PluginClassLoaderFactory
{
    static final List<String> BASE_PARENT_FIRST_PREFIXES = List.of("java.", "javax.", "jdk.", "sun.", "com.queryeer.backend.api.", "com.queryeer.backend.contract.");

    private final SharedClassLoader sharedLoader;
    private final List<String> parentFirstPrefixes;
    private final ExportRegistry exports = new ExportRegistry();

    PluginClassLoaderFactory(SharedClassLoader sharedLoader)
    {
        this(sharedLoader, BASE_PARENT_FIRST_PREFIXES);
    }

    PluginClassLoaderFactory(SharedClassLoader sharedLoader, List<String> parentFirstPrefixes)
    {
        this.sharedLoader = sharedLoader;
        this.parentFirstPrefixes = List.copyOf(parentFirstPrefixes);
    }

    /**
     * A plugin's class loader. It sees the packages its direct dependencies export ({@code backend.exports}), and registers its own exports for the plugins that depend on it. Dependencies are looked
     * up when a class is first needed, so the order plugins are discovered in does not matter.
     */
    URLClassLoader createClassLoader(Path source, PluginManifest manifest)
    {
        List<String> exported = manifest.backend() == null ? List.of()
                : manifest.backend()
                        .exportsOrEmpty();
        return new ParentAwarePluginClassLoader(resolveClasspath(source, manifest).toArray(URL[]::new), sharedLoader, parentFirstPrefixes, manifest.id(), exported, manifest.requiredDependencyIds(),
                manifest.optionalDependencyIds(), exports);
    }

    /**
     * Makes the exports of the plugins that will run visible to their dependents. Called once discovery has settled which plugins are kept (disabled ones and losing duplicates are not), and before
     * any plugin class is loaded: plugins are instantiated at activation.
     */
    void publishExports(List<DiscoveredPlugin> plugins)
    {
        for (DiscoveredPlugin plugin : plugins)
        {
            if (plugin.classLoaderResource() instanceof ParentAwarePluginClassLoader loader)
            {
                exports.register(plugin.manifest()
                        .id(), loader);
            }
        }
    }

    /**
     * Sets which optional dependencies each plugin uses, from the activation plan: a plugin sees an optional dependency's exports only when it uses it. Called before activation, when no plugin class
     * has been loaded yet.
     */
    void useOptionalDependencies(List<DiscoveredPlugin> plugins, Map<String, Set<String>> activeOptionalDependencies)
    {
        for (DiscoveredPlugin plugin : plugins)
        {
            if (plugin.classLoaderResource() instanceof ParentAwarePluginClassLoader loader)
            {
                loader.useOptionalDependencies(activeOptionalDependencies.getOrDefault(loader.pluginId, Set.of()));
            }
        }
    }

    /** Publishes one plugin's exports; see {@link #publishExports(List)}. */
    void publishExports(String pluginId, ClassLoader loader)
    {
        if (loader instanceof ParentAwarePluginClassLoader pluginLoader)
        {
            exports.register(pluginId, pluginLoader);
        }
    }

    static List<URL> resolveClasspath(Path source, PluginManifest manifest)
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
                return urls;
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

        return urls;
    }

    private static void buildManifestClasspath(Path source, PluginManifest.Classpath classpath, List<URL> urls) throws IOException
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

    private static void addClasspathEntriesFromList(Path root, Path listFile, List<URL> urls, Path source) throws IOException
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
            for (String entry : candidate.split(java.util.regex.Pattern.quote(File.pathSeparator)))
            {
                String expanded = entry.trim();
                if (!expanded.isEmpty())
                {
                    addClasspathEntry(root, expanded, urls, source);
                }
            }
        }
    }

    private static void addClasspathEntry(Path root, String candidate, List<URL> urls, Path source) throws IOException
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

    private static void addGlobEntries(Path root, String pattern, List<URL> urls, Path source) throws IOException
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

    private static boolean containsGlob(String candidate)
    {
        return candidate.indexOf('*') >= 0
                || candidate.indexOf('?') >= 0;
    }

    SharedClassLoader sharedLoader()
    {
        return sharedLoader;
    }

    /** The plugin class loaders by plugin id, for resolving a dependency's exports. */
    static final class ExportRegistry
    {
        private final Map<String, ParentAwarePluginClassLoader> loaders = new ConcurrentHashMap<>();

        void register(String pluginId, ParentAwarePluginClassLoader loader)
        {
            loaders.put(pluginId, loader);
        }

        ParentAwarePluginClassLoader get(String pluginId)
        {
            return loaders.get(pluginId);
        }

        /** A plugin other than {@code excludedPluginId} that exports the class's package, or null. */
        String exporterOf(String className, String excludedPluginId)
        {
            return loaders.values()
                    .stream()
                    .filter(loader -> !loader.pluginId.equals(excludedPluginId)
                            && loader.exports(className))
                    .map(loader -> loader.pluginId)
                    .sorted()
                    .findFirst()
                    .orElse(null);
        }
    }

    /**
     * Loads a plugin's classes in this order:
     * <ol>
     * <li>parent-first packages (the JVM, Queryeer's API, shared-runtime contributions) from the shared parent</li>
     * <li>packages exported by a direct dependency, from that dependency's own jars only: there is one copy of each exported class, even when this plugin bundles another</li>
     * <li>the plugin's own jars</li>
     * <li>the shared parent ({@code libShared}, e.g. JDBC drivers)</li>
     * </ol>
     */
    static final class ParentAwarePluginClassLoader extends URLClassLoader
    {
        static
        {
            ClassLoader.registerAsParallelCapable();
        }

        private final List<String> parentFirstPrefixes;
        private final String pluginId;
        private final List<String> exportedPrefixes;
        private final List<String> dependencies;
        private final List<String> optionalDependencies;
        private final ExportRegistry registry;
        /** The optional dependencies in use; none until the activation plan says (see {@link #useOptionalDependencies(Set)}). */
        private volatile Set<String> activeOptionalDependencies = Set.of();

        ParentAwarePluginClassLoader(URL[] urls, ClassLoader parent, List<String> parentFirstPrefixes)
        {
            this(urls, parent, parentFirstPrefixes, "", List.of(), List.of(), new ExportRegistry());
        }

        ParentAwarePluginClassLoader(URL[] urls, ClassLoader parent, List<String> parentFirstPrefixes, String pluginId, List<String> exportedPrefixes, List<String> dependencies,
                ExportRegistry registry)
        {
            this(urls, parent, parentFirstPrefixes, pluginId, exportedPrefixes, dependencies, List.of(), registry);
        }

        ParentAwarePluginClassLoader(URL[] urls, ClassLoader parent, List<String> parentFirstPrefixes, String pluginId, List<String> exportedPrefixes, List<String> dependencies,
                List<String> optionalDependencies, ExportRegistry registry)
        {
            super(urls, parent);
            this.parentFirstPrefixes = List.copyOf(parentFirstPrefixes);
            this.pluginId = pluginId;
            this.exportedPrefixes = List.copyOf(exportedPrefixes);
            this.dependencies = List.copyOf(dependencies);
            this.optionalDependencies = List.copyOf(optionalDependencies);
            this.registry = registry;
        }

        /** The optional dependencies whose exports this plugin sees: those the activation plan says it uses. */
        void useOptionalDependencies(Set<String> active)
        {
            activeOptionalDependencies = Set.copyOf(active);
        }

        boolean exports(String className)
        {
            return exportedPrefixes.stream()
                    .anyMatch(className::startsWith);
        }

        /** An exported class, from this plugin's own jars only: an export is never passed on to the exporter's own dependencies. */
        Class<?> loadExported(String name, String requestingPluginId) throws ClassNotFoundException
        {
            synchronized (getClassLoadingLock(name))
            {
                Class<?> loaded = findLoadedClass(name);
                if (loaded != null)
                {
                    return loaded;
                }
                try
                {
                    return findClass(name);
                }
                catch (ClassNotFoundException e)
                {
                    throw new ClassNotFoundException(name + ": plugin " + pluginId + " exports the package to " + requestingPluginId + ", but has no such class", e);
                }
            }
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

            Class<?> exported = loadFromDependencies(dependencies, name);
            if (exported == null)
            {
                exported = loadFromDependencies(activeOptionalDependencies, name);
            }
            if (exported != null)
            {
                return exported;
            }

            try
            {
                return findClass(name);
            }
            catch (ClassNotFoundException ignored)
            {
                // Not in the plugin's own jars
            }

            try
            {
                return super.loadClass(name, false);
            }
            catch (ClassNotFoundException e)
            {
                String exporter = registry.exporterOf(name, pluginId);
                if (exporter != null
                        && optionalDependencies.contains(exporter))
                {
                    throw new ClassNotFoundException(name + ": plugin "
                                                     + exporter
                                                     + " exports it, but it is an optional dependency of "
                                                     + pluginId
                                                     + " that isn't in use; use its classes only from a DependencyExtension started by DependencyExtension.whenDependencyActive(context, \""
                                                     + exporter
                                                     + "\", ...)",
                            e);
                }
                if (exporter != null)
                {
                    throw new ClassNotFoundException(name + ": plugin " + exporter + " exports it, but " + pluginId + " does not declare a dependency on " + exporter, e);
                }
                throw e;
            }
        }

        /** The class from the dependency among {@code candidates} that exports its package, or null when none does. */
        private Class<?> loadFromDependencies(Iterable<String> candidates, String name) throws ClassNotFoundException
        {
            for (String dependency : candidates)
            {
                ParentAwarePluginClassLoader exporter = registry.get(dependency);
                if (exporter != null
                        && exporter != this
                        && exporter.exports(name))
                {
                    return exporter.loadExported(name, pluginId);
                }
            }
            return null;
        }

        private boolean isParentFirst(String name)
        {
            return parentFirstPrefixes.stream()
                    .anyMatch(name::startsWith);
        }
    }
}
