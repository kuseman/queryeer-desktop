package com.queryeer.backend.api;

public interface BackendPluginFactory
{
    BackendPlugin create(PluginHostServices services);
}
