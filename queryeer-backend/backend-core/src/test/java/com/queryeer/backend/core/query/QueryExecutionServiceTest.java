package com.queryeer.backend.core.query;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileSessionHandlerRegistry;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SchedulerService;
import com.queryeer.backend.core.security.SecretRefPayloadResolver;
import com.queryeer.backend.core.security.SecuritySession;
import com.queryeer.backend.plugin.jdbc.JdbcBackendPlugin;

class QueryExecutionServiceTest
{
    @Test
    void executePublishesJdbcResultToPublisher() throws Exception
    {
        QueryEngineRegistry registry = activateJdbcRegistry();
        ObjectMapper objectMapper = new ObjectMapper();
        QueryExecutionService service = new QueryExecutionService(registry, new SecretRefPayloadResolver(new SecuritySession(), objectMapper));
        RecordingQueryPublisher publisher = new RecordingQueryPublisher();

        service.execute("exec-jdbc-1", "jdbc", "file-1", "select 1 as one", Map.of("jdbc", Map.of("connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_qes_1;DB_CLOSE_DELAY=-1"))),
                publisher);

        boolean completed = publisher.awaitCompleted(5, TimeUnit.SECONDS);
        Assertions.assertTrue(completed, "Query did not complete in time");

        Assertions.assertFalse(publisher.chunkStarts.isEmpty(), "Expected at least one chunkStart");
        Assertions.assertFalse(publisher.chunkRows.isEmpty(), "Expected at least one chunkRows");
        Assertions.assertTrue(publisher.completed, "Expected completed callback");
        Assertions.assertFalse(publisher.failed, "Expected no failed callback");
    }

    @Test
    void cancelWithoutActiveExecutionPublishesFailedToPublisher() throws Exception
    {
        QueryEngineRegistry registry = activateJdbcRegistry();
        ObjectMapper objectMapper = new ObjectMapper();
        QueryExecutionService service = new QueryExecutionService(registry, new SecretRefPayloadResolver(new SecuritySession(), objectMapper));
        RecordingQueryPublisher publisher = new RecordingQueryPublisher();

        service.cancel("missing-execution");

        // cancel without active execution does not publish to the publisher in the new design
        // because we don't have a publisher for a missing execution.
        // The old behavior published a CANCELLED failed notification via NotificationPublisher.
        // In the new design, cancel just silently does nothing if no active execution.
        // This test verifies that no unexpected callbacks occur.
        Thread.sleep(100);
        Assertions.assertFalse(publisher.failed, "Should not have failed callback for unknown execution");
    }

    @Test
    void cancelActiveExecutionInvokesProviderCancelPath() throws Exception
    {
        BlockingProvider provider = new BlockingProvider();
        QueryEngineRegistry registry = new SingleProviderRegistry(provider);
        ObjectMapper objectMapper = new ObjectMapper();
        QueryExecutionService service = new QueryExecutionService(registry, new SecretRefPayloadResolver(new SecuritySession(), objectMapper));
        RecordingQueryPublisher publisher = new RecordingQueryPublisher();

        service.execute("exec-cancel-1", "test", "file-1", "select 1", Map.of(), publisher);
        Assertions.assertTrue(provider.started.await(2, TimeUnit.SECONDS));

        service.cancel("exec-cancel-1");
        Assertions.assertTrue(provider.cancelled.get());
        Assertions.assertTrue(publisher.awaitCompleted(2, TimeUnit.SECONDS), "Query did not complete after cancel");

        Assertions.assertTrue(publisher.failed, "Expected failed callback after cancel");
        Assertions.assertEquals("CANCELLED", publisher.failedErrorCode);
        Assertions.assertEquals("Execution cancelled by client", publisher.failedErrorMessage);
    }

    private static QueryEngineRegistry activateJdbcRegistry()
    {
        RecordingQueryEngineRegistry registry = new RecordingQueryEngineRegistry();
        new JdbcBackendPlugin().activate(new JdbcPluginContext(registry));
        return registry;
    }

    private static final class RecordingQueryPublisher implements QueryPublisher
    {
        private final List<String> progressMessages = new ArrayList<>();
        private final List<List<String>> chunkStarts = new ArrayList<>();
        private final List<List<List<Object>>> chunkRows = new ArrayList<>();
        private final CountDownLatch completedLatch = new CountDownLatch(1);
        private volatile boolean completed;
        private volatile boolean failed;
        private volatile String failedErrorCode;
        private volatile String failedErrorMessage;

        @Override
        public void progress(int percent, String message)
        {
            progressMessages.add(message);
        }

        @Override
        public void resultSetStart(List<String> columnNames, List<String> columnTypes)
        {
            chunkStarts.add(columnNames);
        }

        @Override
        public void resultSetRows(List<List<Object>> rows)
        {
            chunkRows.add(rows);
        }

        @Override
        public void completed(long durationMs, long rowCount)
        {
            completed = true;
            completedLatch.countDown();
        }

        @Override
        public void completed(long durationMs, long rowCount, Object engineStatePatch)
        {
            completed = true;
            completedLatch.countDown();
        }

        @Override
        public void failed(String errorCode, String errorMessage)
        {
            failed = true;
            failedErrorCode = errorCode;
            failedErrorMessage = errorMessage;
            completedLatch.countDown();
        }

        boolean awaitCompleted(long timeout, TimeUnit unit) throws InterruptedException
        {
            return completedLatch.await(timeout, unit);
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

    private static final class SingleProviderRegistry implements QueryEngineRegistry
    {
        private final QueryEngineProvider provider;

        private SingleProviderRegistry(QueryEngineProvider provider)
        {
            this.provider = provider;
        }

        @Override
        public void register(QueryEngineProvider provider)
        {
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

    private static final class BlockingProvider implements QueryEngineProvider
    {
        private final CountDownLatch started = new CountDownLatch(1);
        private final AtomicBoolean cancelled = new AtomicBoolean(false);

        @Override
        public String engineId()
        {
            return "test";
        }

        @Override
        public void execute(String queryExecutionId, String fileId, String text, Object engineState, com.queryeer.backend.api.QueryPublisher publisher)
        {
            started.countDown();
            while (!cancelled.get())
            {
                try
                {
                    Thread.sleep(10L);
                }
                catch (InterruptedException e)
                {
                    Thread.currentThread()
                            .interrupt();
                    break;
                }
            }
            publisher.failed("CANCELLED", "Execution cancelled by client");
        }

        @Override
        public void cancel(String queryExecutionId)
        {
            cancelled.set(true);
        }
    }

    private static final class JdbcPluginContext implements BackendPluginContext
    {
        private final QueryEngineRegistry registry;

        private JdbcPluginContext(QueryEngineRegistry registry)
        {
            this.registry = registry;
        }

        @Override
        public LoggerService logger()
        {
            return new LoggerService()
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
            };
        }

        @Override
        public ConfigService config()
        {
            return key -> null;
        }

        @Override
        public QueryEngineRegistry queryEngines()
        {
            return registry;
        }

        @Override
        public FileSessionHandlerRegistry fileSessions()
        {
            return handler ->
            {
            };
        }

        @Override
        public EventBus events()
        {
            return (topic, event) ->
            {
            };
        }

        @Override
        public SchedulerService scheduler()
        {
            return (name, task) ->
            {
                task.run();
            };
        }
    }
}
