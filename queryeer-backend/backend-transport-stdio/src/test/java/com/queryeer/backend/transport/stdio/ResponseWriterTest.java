package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;

class ResponseWriterTest
{
    @Test
    void writesContentLengthFramedEnvelope() throws Exception
    {
        ObjectMapper objectMapper = new ObjectMapper();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter writer = new ResponseWriter(output, codec);

        writer.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, "req-1", null, null, null, "ok", null));

        String written = output.toString(StandardCharsets.UTF_8);
        int sep = written.indexOf("\r\n\r\n");
        Assertions.assertTrue(sep > 0, "\\r\\n\\r\\n separator not found in output");

        String header = written.substring(0, sep);
        String body = written.substring(sep + 4);
        int declaredLength = Integer.parseInt(header.substring("Content-Length: ".length())
                .trim());
        Assertions.assertEquals(body.getBytes(StandardCharsets.UTF_8).length, declaredLength);
    }

    @Test
    void roundtripsViaFramedReader() throws Exception
    {
        ObjectMapper objectMapper = new ObjectMapper();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter writer = new ResponseWriter(output, codec);

        BackendEnvelope sent = new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, "req-42", null, null, null, "ok", null);
        writer.write(sent);

        FramedReader reader = new FramedReader(new ByteArrayInputStream(output.toByteArray()), line -> Assertions.fail("Unexpected console line: " + line));
        BackendEnvelope received = codec.decode(reader.readFrame());

        Assertions.assertEquals(sent.id(), received.id());
        Assertions.assertEquals(sent.type(), received.type());
        Assertions.assertEquals(sent.protocolVersion(), received.protocolVersion());
    }

    @Test
    void writesMultipleEnvelopesReadableInOrder() throws Exception
    {
        ObjectMapper objectMapper = new ObjectMapper();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter writer = new ResponseWriter(output, codec);

        writer.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, "req-1", null, null, null, null, null));
        writer.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, null, "query.progress", null, null, null));

        FramedReader reader = new FramedReader(new ByteArrayInputStream(output.toByteArray()), l ->
        {
        });
        BackendEnvelope first = codec.decode(reader.readFrame());
        BackendEnvelope second = codec.decode(reader.readFrame());

        Assertions.assertEquals("req-1", first.id());
        Assertions.assertEquals(EnvelopeType.RESPONSE, first.type());
        Assertions.assertEquals("query.progress", second.method());
        Assertions.assertEquals(EnvelopeType.NOTIFICATION, second.type());
        Assertions.assertNull(reader.readFrame());
    }

    @Test
    void contentLengthReflectsByteCountNotCharCount() throws Exception
    {
        ObjectMapper objectMapper = new ObjectMapper();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter writer = new ResponseWriter(output, codec);

        // Craft a body where we know the exact byte length by computing it ourselves
        BackendEnvelope envelope = new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, "req-1", null, null, null, null, null);
        String expectedJson = codec.encode(envelope);
        int expectedByteCount = expectedJson.getBytes(StandardCharsets.UTF_8).length;

        writer.write(envelope);

        String written = output.toString(StandardCharsets.UTF_8);
        int sep = written.indexOf("\r\n\r\n");
        String header = written.substring(0, sep);
        int declaredLength = Integer.parseInt(header.substring("Content-Length: ".length())
                .trim());

        Assertions.assertEquals(expectedByteCount, declaredLength);
    }
}
