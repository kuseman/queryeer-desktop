package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.core.MapperUtils;
import com.queryeer.backend.core.PluginActionService;

class PluginInvokeRequestHandlerTest
{
    @Test
    void returnsWhatThePluginsActionReturned() throws Exception
    {
        PluginActionService actions = new PluginActionService();
        actions.forPlugin("com.example.kafka")
                .register("topics.list", payload -> Map.of("topics", List.of("orders"), "payload", payload));

        BackendEnvelope response = handle(actions, Map.of("pluginId", "com.example.kafka", "action", "topics.list", "payload", Map.of("connectionId", "local")));

        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("req-plugin-invoke", response.id());
        Assertions.assertNull(response.error());
        Map<?, ?> body = (Map<?, ?>) response.result();
        Assertions.assertEquals(Map.of("topics", List.of("orders"), "payload", Map.of("connectionId", "local")), body.get("result"));
    }

    @Test
    void anUnknownActionIsAnActionNotFoundError() throws Exception
    {
        BackendEnvelope response = handle(new PluginActionService(), Map.of("pluginId", "com.example.kafka", "action", "topics.list"));

        Assertions.assertNotNull(response.error());
        Assertions.assertEquals("ACTION_NOT_FOUND", response.error()
                .code()
                .name());
        Assertions.assertEquals("com.example.kafka", response.error()
                .details()
                .get("pluginId"));
    }

    @Test
    void anActionsValidationErrorKeepsItsMessage() throws Exception
    {
        PluginActionService actions = new PluginActionService();
        actions.forPlugin("com.example.kafka")
                .register("topics.list", _ ->
                {
                    throw new IllegalArgumentException("Kafka connection 'x' was not found");
                });

        BackendEnvelope response = handle(actions, Map.of("pluginId", "com.example.kafka", "action", "topics.list"));

        Assertions.assertEquals("VALIDATION", response.error()
                .code()
                .name());
        Assertions.assertEquals("Kafka connection 'x' was not found", response.error()
                .message());
    }

    @Test
    void aRequestWithoutParamsGetsAnErrorResponse() throws Exception
    {
        BackendEnvelope response = handle(new PluginActionService(), null);

        Assertions.assertEquals("VALIDATION", response.error()
                .code()
                .name());
    }

    @Test
    void aResultThatCantBeWrittenGetsAnErrorResponse() throws Exception
    {
        PluginActionService actions = new PluginActionService();
        actions.forPlugin("com.example.kafka")
                .register("topics.list", _ ->
                {
                    // Nested beyond what JSON writing allows
                    Map<String, Object> self = new java.util.HashMap<>();
                    self.put("self", self);
                    return self;
                });

        BackendEnvelope response = handle(actions, Map.of("pluginId", "com.example.kafka", "action", "topics.list"));

        Assertions.assertEquals("INTERNAL", response.error()
                .code()
                .name());
    }

    private static BackendEnvelope handle(PluginActionService actions, Map<String, Object> params) throws Exception
    {
        EnvelopeCodec codec = new EnvelopeCodec(MapperUtils.MAPPER);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        PluginInvokeRequestHandler handler = new PluginInvokeRequestHandler(new ResponseWriter(output, codec), codec, actions);

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-plugin-invoke", null, "plugin.invoke", params, null, null));

        FramedReader reader = new FramedReader(new ByteArrayInputStream(output.toByteArray()), _ ->
        {
        });
        return codec.decode(reader.readFrame());
    }
}
