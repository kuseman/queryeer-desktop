package com.queryeer.backend.api;

public interface BackendPluginContext
{
    LoggerService logger();

    ConfigService config();

    QueryEngineRegistry queryEngines();

    FileSessionHandlerRegistry fileSessions();

    EventBus events();

    SchedulerService scheduler();

    PayloadMapper payloadMapper();

    PluginServiceRegistry services();

    ChangelogRegistry changelogs();

    /**
     * This plugin's backend actions, which its frontend calls with {@code context.backend.invoke}. For a plugin's own UI that needs its backend without being a query engine.
     *
     * @since 0.23.0
     */
    default PluginActionRegistry actions()
    {
        throw new UnsupportedOperationException("Backend actions belong to a plugin: register them from the context a plugin gets in activate");
    }

    /**
     * Whether the plugin with this id is a dependency of the plugin being activated, and is in use: it activated first, and its services are registered. For a required dependency that is false only
     * when its activation failed. For an optional dependency it is also false when the plugin is missing, skipped or out of the declared range, and its exports are then hidden. An optional dependency
     * that is in use but fails to activate can leave its exports visible, so this method, not class visibility, is the check. Needs Queryeer 0.21 or later.
     *
     * <p>
     * To run code that uses an optional dependency's classes, use {@link DependencyExtension#whenDependencyActive(BackendPluginContext, String, String, Object)}, which also keeps those classes from
     * loading too early.
     * </p>
     */
    default boolean isDependencyActive(String pluginId)
    {
        return false;
    }
}
