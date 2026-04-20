package com.queryeer.backend.core;

public record PluginRuntimeStatus(String pluginId, PluginRuntimeState state, String reason)
{
}
