package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;

class EngineInvokeRequestHandlerTest
{
    @Test
    void returnsInvokeResultForKnownEngine() throws Exception
    {
        ObjectMapper objectMapper = new ObjectMapper();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        QueryEngineRegistry registry = new SingleProviderRegistry(new QueryEngineProvider()
        {
            @Override
            public String engineId()
            {
                return "payloadbuilder";
            }

            @Override
            public Object invoke(String fileId, String action, Object payload)
            {
                return Map.of("fileId", fileId, "action", action, "payload", payload);
            }

            @Override
            public void execute(String queryExecutionId, String fileId, String text, Object engineState, com.queryeer.backend.api.QueryPublisher publisher)
            {
            }

            @Override
            public void cancel(String queryExecutionId)
            {
            }
        });

        SecretRefPayloadResolver secretResolver = new SecretRefPayloadResolver(new SecuritySessionBridge(), objectMapper);
        EngineInvokeRequestHandler handler = new EngineInvokeRequestHandler(responseWriter, codec, new EngineInvokeService(registry, secretResolver));

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-invoke-1", null, "queryengine.invoke",
                Map.of("engineId", "payloadbuilder", "fileId", "file-1", "action", "payloadbuilder.echo", "payload", Map.of("x", 1)), null, null));

        FramedReader reader = new FramedReader(new ByteArrayInputStream(output.toByteArray()), l ->
        {
        });
        BackendEnvelope response = codec.decode(reader.readFrame());

        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("req-invoke-1", response.id());
        Assertions.assertNull(response.error());
        Map<?, ?> body = (Map<?, ?>) response.result();
        Map<?, ?> result = (Map<?, ?>) body.get("result");
        Assertions.assertEquals("file-1", result.get("fileId"));
        Assertions.assertEquals("payloadbuilder.echo", result.get("action"));
    }

    @Test
    void returnsEngineNotFoundErrorWhenNoProviderExists() throws Exception
    {
        ObjectMapper objectMapper = new ObjectMapper();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        QueryEngineRegistry registry = new SingleProviderRegistry(null);

        SecretRefPayloadResolver secretResolver = new SecretRefPayloadResolver(new SecuritySessionBridge(), objectMapper);
        EngineInvokeRequestHandler handler = new EngineInvokeRequestHandler(responseWriter, codec, new EngineInvokeService(registry, secretResolver));

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-invoke-2", null, "queryengine.invoke", Map.of("engineId", "missing", "action", "payloadbuilder.echo"),
                null, null));

        FramedReader reader = new FramedReader(new ByteArrayInputStream(output.toByteArray()), l ->
        {
        });
        BackendEnvelope response = codec.decode(reader.readFrame());

        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("req-invoke-2", response.id());
        Assertions.assertNotNull(response.error());
        Assertions.assertEquals("ENGINE_NOT_FOUND", response.error()
                .code()
                .name());
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
