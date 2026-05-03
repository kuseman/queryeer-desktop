package com.queryeer.backend.core;

import java.util.Map;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileSessionHandlerRegistry;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.PluginHostServices;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SchedulerService;

public final class BackendPlatformServices implements PluginHostServices
{
    private final DefaultLoggerService logger;
    private final InMemoryConfigService config;
    private final InMemoryQueryEngineRegistry queryEngines;
    private final DefaultFileRegistry fileRegistry;
    private final InMemoryEventBus events;
    private final InlineSchedulerService scheduler;
    private final BackendPluginContext pluginContext;

    private BackendPlatformServices(DefaultLoggerService logger, InMemoryConfigService config, InMemoryQueryEngineRegistry queryEngines, DefaultFileRegistry fileRegistry, InMemoryEventBus events,
            InlineSchedulerService scheduler, BackendPluginContext pluginContext)
    {
        this.logger = logger;
        this.config = config;
        this.queryEngines = queryEngines;
        this.fileRegistry = fileRegistry;
        this.events = events;
        this.scheduler = scheduler;
        this.pluginContext = pluginContext;
    }

    public static BackendPlatformServices defaultServices()
    {
        return defaultServices(Map.of());
    }

    public static BackendPlatformServices defaultServices(Map<String, String> configValues)
    {
        DefaultLoggerService logger = new DefaultLoggerService();
        InMemoryConfigService config = new InMemoryConfigService(configValues);
        InMemoryQueryEngineRegistry queryEngines = new InMemoryQueryEngineRegistry();
        DefaultFileRegistry fileRegistry = new DefaultFileRegistry();
        InMemoryEventBus events = new InMemoryEventBus();
        InlineSchedulerService scheduler = new InlineSchedulerService(logger);

        BackendPluginContext context = new DefaultBackendPluginContext(logger, config, queryEngines, fileRegistry, events, scheduler);

        return new BackendPlatformServices(logger, config, queryEngines, fileRegistry, events, scheduler, context);
    }

    public BackendPluginContext pluginContext()
    {
        return pluginContext;
    }

    public LoggerService logger()
    {
        return logger;
    }

    public ConfigService config()
    {
        return config;
    }

    public QueryEngineRegistry queryEngines()
    {
        return queryEngines;
    }

    public FileSessionHandlerRegistry fileSessions()
    {
        return fileRegistry;
    }

    public EventBus events()
    {
        return events;
    }

    public SchedulerService scheduler()
    {
        return scheduler;
    }

    public InMemoryQueryEngineRegistry queryEngineRegistryView()
    {
        return queryEngines;
    }

    public DefaultFileRegistry fileRegistryView()
    {
        return fileRegistry;
    }
}
