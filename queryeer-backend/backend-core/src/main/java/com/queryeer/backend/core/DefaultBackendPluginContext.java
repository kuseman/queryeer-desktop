package com.queryeer.backend.core;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.MetadataRegistry;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SchedulerService;
import com.queryeer.backend.api.SecretService;

record DefaultBackendPluginContext(LoggerService logger, ConfigService config, SecretService secrets, QueryEngineRegistry queryEngines, MetadataRegistry metadata, EventBus events,
        SchedulerService scheduler) implements BackendPluginContext
{
}
