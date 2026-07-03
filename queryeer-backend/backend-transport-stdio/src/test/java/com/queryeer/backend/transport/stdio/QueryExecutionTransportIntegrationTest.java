package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.LargeValueStore;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.core.MapperUtils;
import com.queryeer.backend.core.query.QueryExecutionService;

class QueryExecutionTransportIntegrationTest
{
    @Test
    void executePublishesWireFormatNotifications() throws Exception
    {
        ObjectMapper objectMapper = MapperUtils.MAPPER;
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        NotificationPublisher notifications = new NotificationPublisher(responseWriter);

        QueryEngineRegistry registry = new SingleProviderRegistry(new FakeQueryProvider());
        QueryExecutionService queryExecutionService = new QueryExecutionService(registry);
        QueryExecuteRequestHandler handler = new QueryExecuteRequestHandler(responseWriter, codec, queryExecutionService, notifications, LargeValueStore.inlineOnly());

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-exec-1", null, "queryengine.execute",
                Map.of("queryExecutionId", "exec-int-1", "engineId", "fake", "fileId", "file-1", "text", "select 1", "engineState", Map.of()), null, null));

        List<BackendEnvelope> envelopes = awaitNotifications(codec, output, envelope -> "queryengine.completed".equals(envelope.method()));

        Assertions.assertTrue(envelopes.stream()
                .anyMatch(e -> "queryengine.progress".equals(e.method())));
        Assertions.assertTrue(envelopes.stream()
                .anyMatch(e -> "queryengine.chunkStart".equals(e.method())));
        Assertions.assertTrue(envelopes.stream()
                .anyMatch(e -> "queryengine.chunkRows".equals(e.method())));
        Assertions.assertTrue(envelopes.stream()
                .anyMatch(e -> "queryengine.completed".equals(e.method())));
        Assertions.assertFalse(envelopes.stream()
                .anyMatch(e -> "queryengine.failed".equals(e.method())));

        // Verify response envelope is present
        BackendEnvelope response = envelopes.stream()
                .filter(e -> EnvelopeType.RESPONSE.equals(e.type()))
                .findFirst()
                .orElseThrow();
        Assertions.assertEquals("req-exec-1", response.id());
        Assertions.assertNull(response.error());
    }

    private static List<BackendEnvelope> awaitNotifications(EnvelopeCodec codec, ByteArrayOutputStream output, java.util.function.Predicate<BackendEnvelope> donePredicate) throws Exception
    {
        java.time.Instant deadline = java.time.Instant.now()
                .plus(java.time.Duration.ofSeconds(5));
        while (java.time.Instant.now()
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
        FramedReader reader = new FramedReader(new ByteArrayInputStream(payload), _ ->
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

    private static final class FakeQueryProvider implements QueryEngineProvider
    {
        @Override
        public String engineId()
        {
            return "fake";
        }

        @Override
        public void execute(String queryExecutionId, String fileId, String text, Object engineState, QueryPublisher publisher)
        {
            publisher.progress(10, "Starting");
            publisher.resultSetStart(List.of("col1"), List.of("string"));
            publisher.resultSetRows(List.of(List.of("value1")));
            publisher.completed(100, 1);
        }

        @Override
        public void cancel(String queryExecutionId)
        {
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
            if (provider == null)
            {
                return null;
            }
            return provider.engineId()
                    .equals(engineId) ? provider
                            : null;
        }
    }
}
