package com.queryeer.backend.core;

import java.util.Map;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileSessionHandlerRegistry;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.MetadataRegistry;
import com.queryeer.backend.api.PluginHostServices;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SchedulerService;
import com.queryeer.backend.api.SecretService;

public final class BackendPlatformServices implements PluginHostServices
{
    private final DefaultLoggerService logger;
    private final InMemoryConfigService config;
    private final NoopSecretService secrets;
    private final InMemoryQueryEngineRegistry queryEngines;
    private final InMemoryMetadataRegistry metadata;
    private final DefaultFileRegistry fileRegistry;
    private final InMemoryEventBus events;
    private final InlineSchedulerService scheduler;
    private final BackendPluginContext pluginContext;

    private BackendPlatformServices(DefaultLoggerService logger, InMemoryConfigService config, NoopSecretService secrets, InMemoryQueryEngineRegistry queryEngines, InMemoryMetadataRegistry metadata,
            DefaultFileRegistry fileRegistry, InMemoryEventBus events, InlineSchedulerService scheduler, BackendPluginContext pluginContext)
    {
        this.logger = logger;
        this.config = config;
        this.secrets = secrets;
        this.queryEngines = queryEngines;
        this.metadata = metadata;
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
        NoopSecretService secrets = new NoopSecretService();
        InMemoryQueryEngineRegistry queryEngines = new InMemoryQueryEngineRegistry();
        InMemoryMetadataRegistry metadata = new InMemoryMetadataRegistry();
        DefaultFileRegistry fileRegistry = new DefaultFileRegistry();
        InMemoryEventBus events = new InMemoryEventBus();
        InlineSchedulerService scheduler = new InlineSchedulerService(logger);

        BackendPluginContext context = new DefaultBackendPluginContext(logger, config, secrets, queryEngines, metadata, fileRegistry, events, scheduler);

        return new BackendPlatformServices(logger, config, secrets, queryEngines, metadata, fileRegistry, events, scheduler, context);
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

    public SecretService secrets()
    {
        return secrets;
    }

    public QueryEngineRegistry queryEngines()
    {
        return queryEngines;
    }

    public MetadataRegistry metadata()
    {
        return metadata;
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
