package com.queryeer.backend.api;

public interface PluginServiceRegistry
{
    <T> void register(Class<T> serviceType, T service);

    <T> T get(Class<T> serviceType);
}
