package com.queryeer.backend.api;

public interface BackendPlugin
{
    PluginDescriptor descriptor();

    void activate(BackendPluginContext context) throws Exception;

    default void deactivate() throws Exception
    {
    }
}
