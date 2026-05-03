package com.queryeer.backend.api;

public interface PluginHostServices
{
    LoggerService logger();

    ConfigService config();

    QueryEngineRegistry queryEngines();

    FileSessionHandlerRegistry fileSessions();

    EventBus events();

    SchedulerService scheduler();
}
