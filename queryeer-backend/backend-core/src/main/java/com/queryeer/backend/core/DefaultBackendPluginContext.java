package com.queryeer.backend.core;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ChangelogRegistry;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileSessionHandlerRegistry;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.PluginServiceRegistry;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SchedulerService;

record DefaultBackendPluginContext(LoggerService logger, ConfigService config, QueryEngineRegistry queryEngines, FileSessionHandlerRegistry fileSessions, EventBus events, SchedulerService scheduler,
        PayloadMapper payloadMapper, PluginServiceRegistry services, ChangelogRegistry changelogs) implements BackendPluginContext
{
}
