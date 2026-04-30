package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;

class ConnectionUpsertRequestHandlerTest
{
    @Test
    void delegatesOpaqueConnectionPayloadToEngine() throws Exception
    {
        ObjectMapper objectMapper = new ObjectMapper();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ResponseWriter responseWriter = new ResponseWriter(output, codec);

        RecordingProvider provider = new RecordingProvider();
        QueryEngineRegistry registry = new SingleProviderRegistry(provider);
        ConnectionUpsertRequestHandler handler = new ConnectionUpsertRequestHandler(responseWriter, codec, registry);

        Map<String, Object> connection = Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "username", "alice", "password", "secret-ref");

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-upsert-1", null, "connection.upsert",
                Map.of("engineId", "jdbc", "name", "Local JDBC", "connection", connection), null, null));

        FramedReader reader = new FramedReader(new ByteArrayInputStream(output.toByteArray()), l ->
        {
        });
        BackendEnvelope response = codec.decode(reader.readFrame());

        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("req-upsert-1", response.id());
        Assertions.assertNull(response.error());

        Map<?, ?> result = (Map<?, ?>) response.result();
        Assertions.assertEquals("conn-req-upsert-1", result.get("connectionId"));
        Assertions.assertEquals(7, result.get("version"));

        Assertions.assertEquals("connection.upsert", provider.lastAction);
        Assertions.assertInstanceOf(Map.class, provider.lastPayload);
        Map<?, ?> payload = (Map<?, ?>) provider.lastPayload;
        Assertions.assertEquals("conn-req-upsert-1", payload.get("connectionId"));
        Assertions.assertEquals("jdbc", payload.get("engineId"));
        Assertions.assertEquals("Local JDBC", payload.get("name"));
        Assertions.assertEquals(connection, payload.get("connection"));
    }

    @Test
    void returnsEngineNotFoundWhenProviderMissing() throws Exception
    {
        ObjectMapper objectMapper = new ObjectMapper();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        QueryEngineRegistry registry = new SingleProviderRegistry(null);
        ConnectionUpsertRequestHandler handler = new ConnectionUpsertRequestHandler(responseWriter, codec, registry);

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-upsert-2", null, "connection.upsert",
                Map.of("engineId", "missing", "name", "missing", "connection", Map.of("anything", "value")), null, null));

        FramedReader reader = new FramedReader(new ByteArrayInputStream(output.toByteArray()), l ->
        {
        });
        BackendEnvelope response = codec.decode(reader.readFrame());

        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("req-upsert-2", response.id());
        Assertions.assertNotNull(response.error());
        Assertions.assertEquals("ENGINE_NOT_FOUND", response.error()
                .code()
                .name());
    }

    private static final class RecordingProvider implements QueryEngineProvider
    {
        private String lastAction;
        private Object lastPayload;

        @Override
        public String engineId()
        {
            return "jdbc";
        }

        @Override
        public Object invoke(String fileId, String action, Object payload)
        {
            this.lastAction = action;
            this.lastPayload = payload;
            return Map.of("connectionId", "conn-req-upsert-1", "version", 7L);
        }

        @Override
        public void execute(String queryExecutionId, String fileId, String text, Object engineState, QueryPublisher publisher)
        {
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
