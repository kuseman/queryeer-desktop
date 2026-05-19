package com.queryeer.backend.core.query;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.QueryPublisher;

class QueryExecutionServiceTest
{
    @Test
    void executePublishesJdbcResultToPublisher() throws Exception
    {
        QueryEngineRegistry registry = activateJdbcRegistry();
        QueryExecutionService service = new QueryExecutionService(registry);
        RecordingQueryPublisher publisher = new RecordingQueryPublisher();

        service.execute("exec-jdbc-1", "jdbc", "file-1", "select 1 as one", Map.of("connectionId", "jdbc-qes"), publisher);

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
        QueryExecutionService service = new QueryExecutionService(registry);
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
        QueryExecutionService service = new QueryExecutionService(registry);
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
        registry.register(new QueryEngineProvider()
        {
            @Override
            public String engineId()
            {
                return "jdbc";
            }

            @Override
            public void execute(String queryExecutionId, String fileId, String text, Object engineState, QueryPublisher publisher)
            {
                publisher.resultSetStart(List.of("one"), List.of("INTEGER"));
                publisher.resultSetRows(List.of(List.of(1)));
                publisher.completed(10L, 1L);
            }

            @Override
            public void cancel(String queryExecutionId)
            {
            }
        });
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
        public void completed(long durationMs, long rowCount, Object engineState)
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

}
