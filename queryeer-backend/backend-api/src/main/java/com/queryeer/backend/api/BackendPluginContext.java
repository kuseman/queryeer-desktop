package com.queryeer.backend.api;

public interface BackendPluginContext
{
    LoggerService logger();

    ConfigService config();

    QueryEngineRegistry queryEngines();

    FileSessionHandlerRegistry fileSessions();

    EventBus events();

    SchedulerService scheduler();
}
