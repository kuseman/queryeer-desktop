package com.queryeer.backend.api;

public interface BackendPluginContext
{
    LoggerService logger();

    ConfigService config();

    SecretService secrets();

    QueryEngineRegistry queryEngines();

    MetadataRegistry metadata();

    EventBus events();

    SchedulerService scheduler();
}
