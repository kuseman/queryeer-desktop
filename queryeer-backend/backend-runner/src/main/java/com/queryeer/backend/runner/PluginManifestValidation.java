package com.queryeer.backend.runner;

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
                && manifest.frontend() == null)
        {
            throw new PluginDiscoveryException("Plugin must define backend and/or frontend target: " + manifest.id() + " in " + sourceDescription);
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
    }

    private boolean isBlank(String value)
    {
        return value == null
                || value.isBlank();
    }
}
