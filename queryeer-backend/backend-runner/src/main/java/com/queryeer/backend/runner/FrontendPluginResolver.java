package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.Optional;

interface FrontendPluginResolver
{
    Optional<ResolvedFrontendPlugin> resolve(PluginManifest manifest, Path source);

    record ResolvedFrontendPlugin(String pluginId, String entryModule, String moduleFormat, Path source)
    {
    }
}
