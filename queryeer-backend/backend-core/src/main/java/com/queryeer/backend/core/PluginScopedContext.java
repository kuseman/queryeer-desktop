package com.queryeer.backend.core;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ChangelogRegistry;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileSessionHandlerRegistry;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.PluginActionRegistry;
import com.queryeer.backend.api.PluginServiceRegistry;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SchedulerService;

/**
 * The shared plugin context, as one plugin sees it: it knows which of that plugin's dependencies are active, registers backend actions under that plugin's id, and collects the errors the plugin logs
 * while it activates (e.g. an optional feature it skipped), for its status.
 */
record PluginScopedContext(BackendPluginContext delegate, Set<String> activeDependencies, PluginActionRegistry pluginActions, ActivationErrors activationErrors) implements BackendPluginContext
{
    PluginScopedContext(BackendPluginContext delegate, Set<String> activeDependencies, PluginActionRegistry pluginActions)
    {
        this(delegate, activeDependencies, pluginActions, new ActivationErrors());
    }

    @Override
    public LoggerService logger()
    {
        LoggerService logger = delegate.logger();
        if (logger == null)
        {
            return null;
        }
        return new LoggerService()
        {
            @Override
            public void info(String message)
            {
                logger.info(message);
            }

            @Override
            public void warn(String message)
            {
                logger.warn(message);
            }

            @Override
            public void error(String message, Throwable error)
            {
                activationErrors.add(message);
                logger.error(message, error);
            }
        };
    }

    /** The error messages logged until {@link #close()}, i.e. while the plugin activates; later ones are only logged. */
    static final class ActivationErrors
    {
        private final List<String> messages = new ArrayList<>();
        private boolean closed;

        synchronized void add(String message)
        {
            if (!closed)
            {
                messages.add(String.valueOf(message));
            }
        }

        synchronized List<String> close()
        {
            closed = true;
            return List.copyOf(messages);
        }
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
    public PluginActionRegistry actions()
    {
        return pluginActions;
    }

    @Override
    public boolean isDependencyActive(String pluginId)
    {
        return activeDependencies.contains(pluginId);
    }
}
