package com.queryeer.backend.api;

public interface BackendPlugin
{
    default PluginDescriptor descriptor()
    {
        throw new UnsupportedOperationException("Plugin descriptor is provided by plugin manifest at runtime");
    }

    void activate(BackendPluginContext context) throws Exception;

    default void deactivate() throws Exception
    {
    }
}
