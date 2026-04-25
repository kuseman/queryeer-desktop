package com.queryeer.backend.api;

public interface QueryEngineRegistry
{
    void register(QueryEngineProvider provider);

    QueryEngineProvider getProvider(String engineId);
}
