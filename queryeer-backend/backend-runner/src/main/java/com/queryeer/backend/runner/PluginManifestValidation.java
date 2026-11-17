package com.queryeer.backend.runner;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

import com.queryeer.backend.core.SemVer;

final class PluginManifestValidation
{
    void validate(PluginManifest manifest, String sourceDescription)
    {
        if (manifest.schemaVersion() != 1)
        {
            throw new PluginDiscoveryException("Unsupported schemaVersion in " + sourceDescription + ": " + manifest.schemaVersion());
        }

        if (isBlank(manifest.id()))
        {
            throw new PluginDiscoveryException("Plugin id is required in " + sourceDescription);
        }

        if (isBlank(manifest.name()))
        {
            throw new PluginDiscoveryException("Plugin name is required for " + manifest.id() + " in " + sourceDescription);
        }

        if (isBlank(manifest.version()))
        {
            throw new PluginDiscoveryException("Plugin version is required for " + manifest.id() + " in " + sourceDescription);
        }

        if (manifest.backend() == null
                && manifest.frontend() == null
                && (manifest.runtime() == null
                        || manifest.runtime()
                                .shared() == null))
        {
            throw new PluginDiscoveryException("Plugin must define backend, frontend, and/or runtime target: " + manifest.id() + " in " + sourceDescription);
        }

        if (manifest.backend() != null
                && isBlank(manifest.backend()
                        .entrypointClass())
                && isBlank(manifest.backend()
                        .factoryClass()))
        {
            throw new PluginDiscoveryException("Backend entrypointClass or factoryClass is required for plugin " + manifest.id() + " in " + sourceDescription);
        }

        if (manifest.backend() != null
                && manifest.backend()
                        .classpath() != null)
        {
            PluginManifest.Classpath classpath = manifest.backend()
                    .classpath();
            if (isBlank(classpath.root()))
            {
                throw new PluginDiscoveryException("backend.classpath.root is required for plugin " + manifest.id() + " in " + sourceDescription);
            }
            if (classpath.include() == null
                    || classpath.include()
                            .isEmpty())
            {
                throw new PluginDiscoveryException("backend.classpath.include must contain at least one entry for plugin " + manifest.id() + " in " + sourceDescription);
            }
            for (String include : classpath.include())
            {
                if (isBlank(include))
                {
                    throw new PluginDiscoveryException("backend.classpath.include entries must not be blank for plugin " + manifest.id() + " in " + sourceDescription);
                }
            }
        }

        if (manifest.frontend() != null
                && isBlank(manifest.frontend()
                        .entryModule()))
        {
            throw new PluginDiscoveryException("Frontend entryModule is required for plugin " + manifest.id() + " in " + sourceDescription);
        }

        validateDependencies(manifest, sourceDescription);
        validateExports(manifest, sourceDescription);
        validateRuntime(manifest, sourceDescription);
    }

    /** A package prefix of at least two Java identifiers, ending in a dot: {@code org.treesitter.}, {@code com.example.api.}. */
    private static final Pattern EXPORT_PREFIX = Pattern.compile("^[A-Za-z_$][A-Za-z0-9_$]*(\\.[A-Za-z_$][A-Za-z0-9_$]*)+\\.$");

    /** Exported prefixes must name the plugin's own packages: specific enough, and never the JVM's or Queryeer's API, which every plugin already gets from the parent. */
    private void validateExports(PluginManifest manifest, String sourceDescription)
    {
        if (manifest.backend() == null)
        {
            return;
        }
        for (String prefix : manifest.backend()
                .exportsOrEmpty())
        {
            boolean tooBroad = isBlank(prefix)
                    || !EXPORT_PREFIX.matcher(prefix)
                            .matches();
            boolean hostPackage = !tooBroad
                    && PluginClassLoaderFactory.BASE_PARENT_FIRST_PREFIXES.stream()
                            .anyMatch(base -> prefix.startsWith(base)
                                    || base.startsWith(prefix));
            if (tooBroad
                    || hostPackage)
            {
                throw new PluginDiscoveryException("Invalid backend.exports entry for plugin " + manifest.id()
                                                   + " in "
                                                   + sourceDescription
                                                   + ": "
                                                   + prefix
                                                   + " (a package prefix ending in '.' with at least two parts, e.g. com.example.api., outside the JVM's and Queryeer's API packages)");
            }
        }
    }

    private void validateDependencies(PluginManifest manifest, String sourceDescription)
    {
        Set<String> seen = new HashSet<>();
        for (PluginManifest.Dependency dependency : listOrEmpty(manifest.dependencies()))
        {
            if (dependency != null
                    && dependency.problem() != null)
            {
                throw new PluginDiscoveryException("Invalid dependencies entry for plugin " + manifest.id() + " in " + sourceDescription + ": " + dependency.problem());
            }
            if (dependency == null
                    || isBlank(dependency.id()))
            {
                throw new PluginDiscoveryException("dependencies entries need an id for plugin " + manifest.id() + " in " + sourceDescription);
            }
            if (!seen.add(dependency.id()))
            {
                throw new PluginDiscoveryException("Duplicate dependency " + dependency.id() + " for plugin " + manifest.id() + " in " + sourceDescription);
            }
            if (dependency.version() != null)
            {
                try
                {
                    SemVer.validateRange(dependency.version());
                }
                catch (IllegalArgumentException e)
                {
                    throw new PluginDiscoveryException("Invalid version range for dependency " + dependency.id() + " of plugin " + manifest.id() + " in " + sourceDescription + ": " + e.getMessage());
                }
            }
        }
    }

    private void validateRuntime(PluginManifest manifest, String sourceDescription)
    {
        if (manifest.runtime() == null
                || manifest.runtime()
                        .shared() == null)
        {
            return;
        }

        PluginManifest.SharedRuntime shared = manifest.runtime()
                .shared();
        for (String prefix : listOrEmpty(shared.parentFirstPackagePrefixes()))
        {
            if (isBlank(prefix)
                    || prefix.length() < "a.b.".length()
                    || !prefix.endsWith(".")
                    || prefix.equals("com.")
                    || prefix.equals("org."))
            {
                throw new PluginDiscoveryException("Invalid runtime.shared.parentFirstPackagePrefixes entry for plugin " + manifest.id() + " in " + sourceDescription + ": " + prefix);
            }
        }

        for (PluginManifest.NativeLibrary library : listOrEmpty(shared.nativeLibraries()))
        {
            if (library.filePatterns() == null
                    || library.filePatterns()
                            .isEmpty())
            {
                throw new PluginDiscoveryException("runtime.shared.nativeLibraries.filePatterns is required for plugin " + manifest.id() + " in " + sourceDescription);
            }
            for (String pattern : library.filePatterns())
            {
                if (isBlank(pattern)
                        || pattern.contains("..")
                        || pattern.contains("/")
                        || pattern.contains("\\"))
                {
                    throw new PluginDiscoveryException("Invalid runtime.shared.nativeLibraries.filePatterns entry for plugin " + manifest.id() + " in " + sourceDescription + ": " + pattern);
                }
            }
        }
    }

    private <T> List<T> listOrEmpty(List<T> values)
    {
        return values == null ? List.of()
                : values;
    }

    private boolean isBlank(String value)
    {
        return value == null
                || value.isBlank();
    }
}
