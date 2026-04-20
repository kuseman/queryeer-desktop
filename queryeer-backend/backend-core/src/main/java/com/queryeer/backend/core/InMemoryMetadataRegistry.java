package com.queryeer.backend.core;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

import com.queryeer.backend.api.MetadataProvider;
import com.queryeer.backend.api.MetadataRegistry;

final class InMemoryMetadataRegistry implements MetadataRegistry
{
    private final Map<String, MetadataProvider> providersById = new LinkedHashMap<>();

    @Override
    public synchronized void register(MetadataProvider provider)
    {
        providersById.put(provider.id(), provider);
    }

    public synchronized Collection<MetadataProvider> providers()
    {
        return providersById.values();
    }

    public synchronized int size()
    {
        return providersById.size();
    }
}
