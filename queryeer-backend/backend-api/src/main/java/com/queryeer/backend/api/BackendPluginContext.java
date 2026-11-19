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
     * Whether the plugin with this id is a dependency of the plugin being activated, and is in use: it activated first, and its services are registered. For a required dependency that is false only
     * when its activation failed. For an optional dependency it is also false when the plugin is missing, skipped or out of the declared range, and its exports are then hidden. An optional dependency
     * that is in use but fails to activate can leave its exports visible, so this method, not class visibility, is the check. Needs Queryeer 0.21 or later.
     *
     * <p>
     * Check it before touching an optional dependency's classes. Keep the code that uses them in a class of its own, loaded only when this returns true:
     * </p>
     *
     * <pre>{@code
     * if (context.isDependencyActive("queryengine.payloadbuilder"))
     * {
     *     PayloadbuilderSupport.register(context); // the only class that imports payloadbuilder types
     * }
     * }</pre>
     */
    default boolean isDependencyActive(String pluginId)
    {
        return false;
    }
}
