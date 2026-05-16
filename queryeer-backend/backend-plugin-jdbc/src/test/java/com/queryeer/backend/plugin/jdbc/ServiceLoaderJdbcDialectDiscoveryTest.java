package com.queryeer.backend.plugin.jdbc;

import static org.mockito.Mockito.mock;

import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ChangelogRegistry;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileSessionHandlerRegistry;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.PluginServiceRegistry;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SchedulerService;
import com.queryeer.backend.queryengine.jdbc.DefaultJdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryResult;

class ServiceLoaderJdbcDialectDiscoveryTest
{
    @Test
    void discoverAndRegisterSkipsDuplicateDialectId()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        ServiceLoaderJdbcDialectDiscovery discovery = new ServiceLoaderJdbcDialectDiscovery(getClass().getClassLoader());

        discovery.discoverAndRegister(registry, new NoopLoggerService());

        Assertions.assertTrue(registry.find("jdbc")
                .isPresent());
    }

    @Test
    void backendPluginUsesInjectedDialectDiscovery()
    {
        TrackingDiscovery discovery = new TrackingDiscovery();
        JdbcBackendPlugin plugin = new JdbcBackendPlugin(discovery);
        RecordingQueryEngineRegistry registry = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();

        plugin.activate(new TestPluginContext(registry, fileSessions), null);

        Assertions.assertTrue(discovery.called);
        Assertions.assertNotNull(registry.provider);
        Assertions.assertNotNull(fileSessions.handler);
    }

    private static final class TrackingDiscovery implements JdbcDialectDiscovery
    {
        private boolean called;

        @Override
        public void discoverAndRegister(JdbcDialectRegistry registry, LoggerService logger)
        {
            called = true;
            registry.register(new JdbcDialect()
            {
                @Override
                public JdbcDialectMetadata metadata()
                {
                    return new JdbcDialectMetadata("tracking", "Tracking", null, "jdbc:tracking://<host>", null);
                }

                @Override
                public JdbcQueryExecutor queryExecutor()
                {
                    return (_, _) -> new JdbcQueryResult(0, java.util.Map.of());
                }

                @Override
                public String buildUrl(Map<String, Object> materializedProperties)
                {
                    return null;
                }
            });
        }
    }

    private static final class NoopLoggerService implements LoggerService
    {
        @Override
        public void info(String message)
        {
        }

        @Override
        public void warn(String message)
        {
        }

        @Override
        public void error(String message, Throwable error)
        {
        }
    }

    private static final class RecordingQueryEngineRegistry implements QueryEngineRegistry
    {
        private QueryEngineProvider provider;

        @Override
        public void register(QueryEngineProvider provider)
        {
            this.provider = provider;
        }

        @Override
        public QueryEngineProvider getProvider(String engineId)
        {
            return provider != null
                    && provider.engineId()
                            .equals(engineId) ? provider
                                    : null;
        }
    }

    private static final class TestPluginContext implements BackendPluginContext
    {
        private final QueryEngineRegistry queryEngineRegistry;
        private final FileSessionHandlerRegistry fileSessionHandlerRegistry;
        private final PayloadMapper payloadMapper = TestPayloadMapper.INSTANCE;

        private TestPluginContext(QueryEngineRegistry queryEngineRegistry, FileSessionHandlerRegistry fileSessionHandlerRegistry)
        {
            this.queryEngineRegistry = queryEngineRegistry;
            this.fileSessionHandlerRegistry = fileSessionHandlerRegistry;
        }

        @Override
        public LoggerService logger()
        {
            return new NoopLoggerService();
        }

        @Override
        public ConfigService config()
        {
            return _ -> null;
        }

        @Override
        public QueryEngineRegistry queryEngines()
        {
            return queryEngineRegistry;
        }

        @Override
        public FileSessionHandlerRegistry fileSessions()
        {
            return fileSessionHandlerRegistry;
        }

        @Override
        public EventBus events()
        {
            return (_, _) ->
            {
            };
        }

        @Override
        public SchedulerService scheduler()
        {
            return (_, task) ->
            {
                task.run();
            };
        }

        @Override
        public PayloadMapper payloadMapper()
        {
            return payloadMapper;
        }

        @Override
        public PluginServiceRegistry services()
        {
            return mock(PluginServiceRegistry.class);
        }

        @Override
        public ChangelogRegistry changelogs()
        {
            return new ChangelogRegistry()
            {
                @Override
                public void registerChangelog(String pluginId, String changelog)
                {
                }

                @Override
                public java.util.List<String> pluginIds()
                {
                    return java.util.List.of();
                }

                @Override
                public String getChangelog(String pluginId)
                {
                    return null;
                }
            };
        }
    }

    private static final class RecordingFileSessionHandlerRegistry implements FileSessionHandlerRegistry
    {
        private com.queryeer.backend.api.FileSessionHandler handler;

        @Override
        public void register(com.queryeer.backend.api.FileSessionHandler handler)
        {
            this.handler = handler;
        }
    }
}
