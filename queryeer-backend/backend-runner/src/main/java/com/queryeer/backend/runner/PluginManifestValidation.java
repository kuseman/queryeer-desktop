package com.queryeer.backend.runner;

import java.util.List;

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
        }

        if (manifest.frontend() != null
                && isBlank(manifest.frontend()
                        .entryModule()))
        {
            throw new PluginDiscoveryException("Frontend entryModule is required for plugin " + manifest.id() + " in " + sourceDescription);
        }

        validateRuntime(manifest, sourceDescription);
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
            if (isBlank(library.loaderClass()))
            {
                throw new PluginDiscoveryException("runtime.shared.nativeLibraries.loaderClass is required for plugin " + manifest.id() + " in " + sourceDescription);
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
