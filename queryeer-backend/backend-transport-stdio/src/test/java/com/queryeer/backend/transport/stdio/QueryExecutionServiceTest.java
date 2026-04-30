package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.time.Duration;
import java.time.Instant;
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
import com.queryeer.backend.api.MetadataRegistry;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.SchedulerService;
import com.queryeer.backend.api.SecretService;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.query.QueryCancelParams;
import com.queryeer.backend.contract.query.QueryExecuteParams;
import com.queryeer.backend.plugin.jdbc.JdbcBackendPlugin;

class QueryExecutionServiceTest
{
    @Test
    void executePublishesJdbcResultNotifications() throws Exception
    {
        QueryEngineRegistry registry = activateJdbcRegistry();
        ObjectMapper objectMapper = new ObjectMapper();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        NotificationPublisher notifications = new NotificationPublisher(responseWriter);
        QueryExecutionService service = new QueryExecutionService(registry, notifications, new SecretRefPayloadResolver(new SecuritySessionBridge(), objectMapper));

        QueryExecuteParams params = new QueryExecuteParams("exec-jdbc-1", "jdbc", "file-1", "select 1 as one", List.of(),
                Map.of("jdbc", Map.of("connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_qes_1;DB_CLOSE_DELAY=-1"))), null);

        service.execute(params);

        List<BackendEnvelope> envelopes = awaitNotifications(codec, output, envelope -> "queryengine.completed".equals(envelope.method()));
        Assertions.assertTrue(envelopes.stream()
                .anyMatch(envelope -> "queryengine.chunkStart".equals(envelope.method())));
        Assertions.assertTrue(envelopes.stream()
                .anyMatch(envelope -> "queryengine.chunkRows".equals(envelope.method())));
        Assertions.assertTrue(envelopes.stream()
                .anyMatch(envelope -> "queryengine.completed".equals(envelope.method())));
        Assertions.assertFalse(envelopes.stream()
                .anyMatch(envelope -> "queryengine.failed".equals(envelope.method())));
    }

    @Test
    void cancelWithoutActiveExecutionPublishesCancelledFailedNotification() throws Exception
    {
        QueryEngineRegistry registry = activateJdbcRegistry();
        ObjectMapper objectMapper = new ObjectMapper();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        NotificationPublisher notifications = new NotificationPublisher(responseWriter);
        QueryExecutionService service = new QueryExecutionService(registry, notifications, new SecretRefPayloadResolver(new SecuritySessionBridge(), objectMapper));

        service.cancel(new QueryCancelParams("missing-execution", "client-request"));

        List<BackendEnvelope> envelopes = decodeEnvelopes(codec, output.toByteArray());
        BackendEnvelope failed = envelopes.stream()
                .filter(envelope -> "queryengine.failed".equals(envelope.method()))
                .findFirst()
                .orElseThrow();
        Map<?, ?> params = (Map<?, ?>) failed.params();
        Map<?, ?> error = (Map<?, ?>) params.get("error");
        Assertions.assertEquals(BackendErrorCode.CANCELLED.name(), error.get("code"));
    }

    @Test
    void executeWithoutFileIdIsRejectedByContract()
    {
        Assertions.assertThrows(IllegalArgumentException.class, () -> new QueryExecuteParams("exec-missing-file", "jdbc", null, "select 1", List.of(),
                Map.of("jdbc", Map.of("connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_missing_file;DB_CLOSE_DELAY=-1"))), null));
    }

    @Test
    void cancelActiveExecutionInvokesProviderCancelPath() throws Exception
    {
        BlockingProvider provider = new BlockingProvider();
        QueryEngineRegistry registry = new SingleProviderRegistry(provider);
        ObjectMapper objectMapper = new ObjectMapper();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        NotificationPublisher notifications = new NotificationPublisher(responseWriter);
        QueryExecutionService service = new QueryExecutionService(registry, notifications, new SecretRefPayloadResolver(new SecuritySessionBridge(), objectMapper));

        QueryExecuteParams params = new QueryExecuteParams("exec-cancel-1", "test", "file-1", "select 1", List.of(), Map.of(), null);
        service.execute(params);
        Assertions.assertTrue(provider.started.await(2, TimeUnit.SECONDS));

        service.cancel(new QueryCancelParams("exec-cancel-1", "client-request"));

        List<BackendEnvelope> envelopes = awaitNotifications(codec, output, envelope -> "queryengine.failed".equals(envelope.method()));
        BackendEnvelope failed = envelopes.stream()
                .filter(envelope -> "queryengine.failed".equals(envelope.method()))
                .findFirst()
                .orElseThrow();
        Map<?, ?> failedParams = (Map<?, ?>) failed.params();
        Map<?, ?> error = (Map<?, ?>) failedParams.get("error");
        Assertions.assertEquals(BackendErrorCode.CANCELLED.name(), error.get("code"));
        Assertions.assertTrue(provider.cancelled.get());
    }

    private static QueryEngineRegistry activateJdbcRegistry()
    {
        RecordingQueryEngineRegistry registry = new RecordingQueryEngineRegistry();
        new JdbcBackendPlugin().activate(new JdbcPluginContext(registry));
        return registry;
    }

    private static List<BackendEnvelope> awaitNotifications(EnvelopeCodec codec, ByteArrayOutputStream output, java.util.function.Predicate<BackendEnvelope> donePredicate) throws Exception
    {
        Instant deadline = Instant.now()
                .plus(Duration.ofSeconds(5));
        while (Instant.now()
                .isBefore(deadline))
        {
            List<BackendEnvelope> envelopes = decodeEnvelopes(codec, output.toByteArray());
            if (envelopes.stream()
                    .anyMatch(donePredicate))
            {
                return envelopes;
            }
            Thread.sleep(50L);
        }
        return decodeEnvelopes(codec, output.toByteArray());
    }

    private static List<BackendEnvelope> decodeEnvelopes(EnvelopeCodec codec, byte[] payload) throws Exception
    {
        FramedReader reader = new FramedReader(new ByteArrayInputStream(payload), line ->
        {
        });
        List<BackendEnvelope> envelopes = new ArrayList<>();
        while (true)
        {
            String frame = reader.readFrame();
            if (frame == null)
            {
                return envelopes;
            }
            envelopes.add(codec.decode(frame));
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
        public SecretService secrets()
        {
            return key -> new char[0];
        }

        @Override
        public QueryEngineRegistry queryEngines()
        {
            return registry;
        }

        @Override
        public MetadataRegistry metadata()
        {
            return provider ->
            {
            };
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
