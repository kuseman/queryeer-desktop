package com.queryeer.backend.core;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;

final class InMemoryQueryEngineRegistry implements QueryEngineRegistry
{
    private final Map<String, QueryEngineProvider> providersById = new LinkedHashMap<>();

    @Override
    public synchronized void register(QueryEngineProvider provider)
    {
        providersById.put(provider.engineId(), provider);
    }

    public synchronized Collection<QueryEngineProvider> providers()
    {
        return providersById.values();
    }

    public synchronized int size()
    {
        return providersById.size();
    }
}
