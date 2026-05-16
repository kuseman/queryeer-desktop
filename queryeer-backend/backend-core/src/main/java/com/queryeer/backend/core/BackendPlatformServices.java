package com.queryeer.backend.core;

import java.util.Map;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ChangelogRegistry;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileSessionHandlerRegistry;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.PluginHostServices;
import com.queryeer.backend.api.PluginServiceRegistry;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SchedulerService;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.core.security.SecuritySession;

public final class BackendPlatformServices implements PluginHostServices
{
    private final DefaultLoggerService logger;
    private final ConfigService config;
    private final InMemoryQueryEngineRegistry queryEngines;
    private final DefaultFileRegistry fileRegistry;
    private final InMemoryEventBus events;
    private final InlineSchedulerService scheduler;
    private final BackendPluginContext pluginContext;
    private final PayloadMapper payloadMapper;
    private final InMemoryChangelogRegistry changelogs;

    private BackendPlatformServices(DefaultLoggerService logger, ConfigService config, InMemoryQueryEngineRegistry queryEngines, DefaultFileRegistry fileRegistry, InMemoryEventBus events,
            InlineSchedulerService scheduler, BackendPluginContext pluginContext, PayloadMapper payloadMapper, InMemoryChangelogRegistry changelogs)
    {
        this.logger = logger;
        this.config = config;
        this.queryEngines = queryEngines;
        this.fileRegistry = fileRegistry;
        this.events = events;
        this.scheduler = scheduler;
        this.pluginContext = pluginContext;
        this.payloadMapper = payloadMapper;
        this.changelogs = changelogs;
    }

    public static BackendPlatformServices defaultServices()
    {
        return defaultServices(Map.of());
    }

    /** Creates services with {@link InMemoryConfigService}. For tests. */
    public static BackendPlatformServices defaultServices(Map<String, String> configValues)
    {
        DefaultLoggerService logger = new DefaultLoggerService();
        ConfigService config = new InMemoryConfigService(configValues);
        InMemoryQueryEngineRegistry queryEngines = new InMemoryQueryEngineRegistry();
        DefaultFileRegistry fileRegistry = new DefaultFileRegistry();
        InMemoryEventBus events = new InMemoryEventBus();
        InlineSchedulerService scheduler = new InlineSchedulerService(logger);
        PayloadMapper payloadMapper = new JacksonPayloadMapper(MapperUtils.MAPPER);
        PluginServiceRegistry services = new InMemoryPluginServiceRegistry();
        services.register(IncrementalParseSessionService.class, new DefaultIncrementalParseSessionService());
        InMemoryChangelogRegistry changelogs = new InMemoryChangelogRegistry();

        BackendPluginContext context = new DefaultBackendPluginContext(logger, config, queryEngines, fileRegistry, events, scheduler, payloadMapper, services, changelogs);

        return new BackendPlatformServices(logger, config, queryEngines, fileRegistry, events, scheduler, context, payloadMapper, changelogs);
    }

    /** Creates services with {@link FileBasedConfigService} connected to the given security session. */
    public static BackendPlatformServices fileBased(Map<String, String> configValues, SecuritySession securitySession)
    {
        DefaultLoggerService logger = new DefaultLoggerService();
        ConfigService config = new FileBasedConfigService(configValues, securitySession, logger);
        InMemoryQueryEngineRegistry queryEngines = new InMemoryQueryEngineRegistry();
        DefaultFileRegistry fileRegistry = new DefaultFileRegistry();
        InMemoryEventBus events = new InMemoryEventBus();
        InlineSchedulerService scheduler = new InlineSchedulerService(logger);
        PayloadMapper payloadMapper = new JacksonPayloadMapper(MapperUtils.MAPPER);
        PluginServiceRegistry services = new InMemoryPluginServiceRegistry();
        services.register(IncrementalParseSessionService.class, new DefaultIncrementalParseSessionService());
        InMemoryChangelogRegistry changelogs = new InMemoryChangelogRegistry();

        BackendPluginContext context = new DefaultBackendPluginContext(logger, config, queryEngines, fileRegistry, events, scheduler, payloadMapper, services, changelogs);

        return new BackendPlatformServices(logger, config, queryEngines, fileRegistry, events, scheduler, context, payloadMapper, changelogs);
    }

    public ChangelogRegistry changelogRegistry()
    {
        return changelogs;
    }

    public BackendPluginContext pluginContext()
    {
        return pluginContext;
    }

    @Override
    public LoggerService logger()
    {
        return logger;
    }

    @Override
    public ConfigService config()
    {
        return config;
    }

    @Override
    public QueryEngineRegistry queryEngines()
    {
        return queryEngines;
    }

    @Override
    public FileSessionHandlerRegistry fileSessions()
    {
        return fileRegistry;
    }

    @Override
    public EventBus events()
    {
        return events;
    }

    @Override
    public SchedulerService scheduler()
    {
        return scheduler;
    }

    @Override
    public PayloadMapper payloadMapper()
    {
        return payloadMapper;
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
