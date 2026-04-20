package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.Optional;

import com.queryeer.backend.api.BackendPlugin;

interface BackendPluginResolver
{
    Optional<BackendPlugin> resolve(PluginManifest manifest, Path source);
}
