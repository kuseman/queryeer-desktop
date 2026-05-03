package com.queryeer.backend.core;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileSessionHandlerRegistry;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SchedulerService;

record DefaultBackendPluginContext(LoggerService logger, ConfigService config, QueryEngineRegistry queryEngines, FileSessionHandlerRegistry fileSessions, EventBus events, SchedulerService scheduler)
        implements BackendPluginContext
{
}
