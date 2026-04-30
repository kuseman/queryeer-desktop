package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.Optional;

interface BackendPluginResolver
{
    Optional<DiscoveredPlugin> resolve(PluginManifest manifest, Path source);
}
