package com.queryeer.backend.contract.plugin;

/** {@code plugin.invoke}: calls a backend action the plugin {@code pluginId} registered (PluginActionRegistry). Since 0.23.0. */
public record PluginInvokeParams(String pluginId, String action, Object payload)
{
}
