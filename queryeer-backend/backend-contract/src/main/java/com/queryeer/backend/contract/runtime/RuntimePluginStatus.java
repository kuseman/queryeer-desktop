package com.queryeer.backend.contract.runtime;

public record RuntimePluginStatus(String pluginId, RuntimePluginState state, String reason)
{
}
