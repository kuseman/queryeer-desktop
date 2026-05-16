package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.ChangelogRegistry;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.about.PluginChangelogsResult;

class AboutPluginChangelogsRequestHandlerTest
{
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void returnsEmptyListWhenNoChangelogsRegistered() throws IOException
    {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        ChangelogRegistry registry = new InMemoryTestRegistry();

        AboutPluginChangelogsRequestHandler handler = new AboutPluginChangelogsRequestHandler(responseWriter, registry, _ -> null);
        Assertions.assertEquals("about.pluginChangelogs", handler.method());

        BackendEnvelope request = new BackendEnvelope(ProtocolVersion.V1_0_0, com.queryeer.backend.contract.EnvelopeType.REQUEST, "req-1", "about.pluginChangelogs", null, null, null, null);
        handler.handle(request);

        PluginChangelogsResult result = parseResult(output, codec);
        Assertions.assertNotNull(result);
        Assertions.assertTrue(result.plugins()
                .isEmpty());
    }

    @Test
    void returnsRegisteredChangelogsEnrichedWithDescriptorInfo() throws IOException
    {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter responseWriter = new ResponseWriter(output, codec);
        InMemoryTestRegistry registry = new InMemoryTestRegistry();
        registry.registerChangelog("pb", "# PB");
        registry.registerChangelog("jdbc", "# JDBC");

        Map<String, PluginDescriptor> descriptors = new HashMap<>();
        descriptors.put("pb", new PluginDescriptor("pb", "PayloadBuilder", "1.0.0", java.util.List.of(), java.util.List.of(), java.util.List.of()));
        descriptors.put("jdbc", new PluginDescriptor("jdbc", "JDBC Engine", "2.0.0", java.util.List.of(), java.util.List.of(), java.util.List.of()));

        AboutPluginChangelogsRequestHandler handler = new AboutPluginChangelogsRequestHandler(responseWriter, registry, descriptors::get);

        BackendEnvelope request = new BackendEnvelope(ProtocolVersion.V1_0_0, com.queryeer.backend.contract.EnvelopeType.REQUEST, "req-1", "about.pluginChangelogs", null, null, null, null);
        handler.handle(request);

        PluginChangelogsResult result = parseResult(output, codec);
        Assertions.assertNotNull(result);
        Assertions.assertEquals(2, result.plugins()
                .size());

        PluginChangelogsResult.BackendPluginChangelog pb = result.plugins()
                .stream()
                .filter(p -> p.pluginId()
                        .equals("pb"))
                .findFirst()
                .orElseThrow();
        Assertions.assertEquals("PayloadBuilder", pb.pluginName());
        Assertions.assertEquals("1.0.0", pb.version());
        Assertions.assertEquals("# PB", pb.changelog());
    }

    private PluginChangelogsResult parseResult(ByteArrayOutputStream output, EnvelopeCodec codec) throws IOException
    {
        FramedReader reader = new FramedReader(new ByteArrayInputStream(output.toByteArray()), _ ->
        {
        });
        BackendEnvelope envelope = codec.decode(reader.readFrame());
        return objectMapper.convertValue(envelope.result(), PluginChangelogsResult.class);
    }

    private static final class InMemoryTestRegistry implements ChangelogRegistry
    {
        private final java.util.Map<String, String> changelogs = new java.util.LinkedHashMap<>();

        @Override
        public void registerChangelog(String pluginId, String changelog)
        {
            changelogs.put(pluginId, changelog);
        }

        @Override
        public java.util.List<String> pluginIds()
        {
            return java.util.List.copyOf(changelogs.keySet());
        }

        @Override
        public String getChangelog(String pluginId)
        {
            return changelogs.get(pluginId);
        }
    }
}
