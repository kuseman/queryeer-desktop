package com.queryeer.backend.core;

import java.util.Set;

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

/** The shared plugin context, as one plugin sees it: it knows which of that plugin's dependencies are active. */
record PluginScopedContext(BackendPluginContext delegate, Set<String> activeDependencies) implements BackendPluginContext
{
    @Override
    public LoggerService logger()
    {
        return delegate.logger();
    }

    @Override
    public ConfigService config()
    {
        return delegate.config();
    }

    @Override
    public QueryEngineRegistry queryEngines()
    {
        return delegate.queryEngines();
    }

    @Override
    public FileSessionHandlerRegistry fileSessions()
    {
        return delegate.fileSessions();
    }

    @Override
    public EventBus events()
    {
        return delegate.events();
    }

    @Override
    public SchedulerService scheduler()
    {
        return delegate.scheduler();
    }

    @Override
    public PayloadMapper payloadMapper()
    {
        return delegate.payloadMapper();
    }

    @Override
    public PluginServiceRegistry services()
    {
        return delegate.services();
    }

    @Override
    public ChangelogRegistry changelogs()
    {
        return delegate.changelogs();
    }

    @Override
    public boolean isDependencyActive(String pluginId)
    {
        return activeDependencies.contains(pluginId);
    }
}
