package com.queryeer.backend.runner;

import java.nio.file.Path;

import com.queryeer.backend.api.BackendPlugin;

record DiscoveredPlugin(PluginManifest manifest, BackendPlugin plugin, Path source, boolean isolatedClassLoader)
{
}
