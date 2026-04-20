package com.queryeer.backend.core;

import java.util.Map;

import com.queryeer.backend.api.ConfigService;

final class InMemoryConfigService implements ConfigService
{
    private final Map<String, String> values;

    public InMemoryConfigService(Map<String, String> values)
    {
        this.values = Map.copyOf(values);
    }

    @Override
    public String get(String key)
    {
        return values.get(key);
    }
}
