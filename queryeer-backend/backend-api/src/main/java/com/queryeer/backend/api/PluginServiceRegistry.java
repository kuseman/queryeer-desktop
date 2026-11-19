package com.queryeer.backend.api;

public interface PluginServiceRegistry
{
    <T> void register(Class<T> serviceType, T service);

    /** The registered service, or null when no plugin registered one. */
    <T> T get(Class<T> serviceType);

    /**
     * The registered service, for one a plugin can't work without. Throws when it is missing, with a message that says what to check: the plugin that registers it is a dependency in
     * {@code plugin.json}, so it activates first, and it loaded (Observability lists why not). Needs Queryeer 0.21 or later.
     *
     * @throws IllegalStateException when no plugin registered the service
     */
    default <T> T require(Class<T> serviceType)
    {
        T service = get(serviceType);
        if (service == null)
        {
            throw new IllegalStateException(serviceType.getName() + " is not registered. The plugin that provides it must be a dependency in plugin.json, so it activates first, and must have loaded: "
                                            + "Observability shows why a plugin didn't.");
        }
        return service;
    }
}
