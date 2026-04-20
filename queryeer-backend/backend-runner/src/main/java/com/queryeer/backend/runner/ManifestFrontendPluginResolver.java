package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.Optional;

final class ManifestFrontendPluginResolver implements FrontendPluginResolver
{
    @Override
    public Optional<ResolvedFrontendPlugin> resolve(PluginManifest manifest, Path source)
    {
        if (manifest.frontend() == null)
        {
            return Optional.empty();
        }

        return Optional.of(new ResolvedFrontendPlugin(manifest.id(), manifest.frontend()
                .entryModule(),
                manifest.frontend()
                        .moduleFormat(),
                source));
    }
}
