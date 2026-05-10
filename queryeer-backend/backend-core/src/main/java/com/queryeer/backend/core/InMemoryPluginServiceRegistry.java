package com.queryeer.backend.core;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.queryeer.backend.api.PluginServiceRegistry;

final class InMemoryPluginServiceRegistry implements PluginServiceRegistry
{
    private final Map<Class<?>, Object> services = new ConcurrentHashMap<>();

    @Override
    public <T> void register(Class<T> serviceType, T service)
    {
        services.put(serviceType, service);
    }

    @Override
    public <T> T get(Class<T> serviceType)
    {
        Object service = services.get(serviceType);
        return serviceType.isInstance(service) ? serviceType.cast(service)
                : null;
    }
}
