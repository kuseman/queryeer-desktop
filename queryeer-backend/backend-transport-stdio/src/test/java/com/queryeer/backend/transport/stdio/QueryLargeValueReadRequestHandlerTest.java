package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.query.QueryLargeValueCell;
import com.queryeer.backend.contract.query.QueryLargeValueReadResult;
import com.queryeer.backend.core.DefaultLargeValueStore;
import com.queryeer.backend.core.MapperUtils;

class QueryLargeValueReadRequestHandlerTest
{
    @TempDir
    Path tempDir;

    @Test
    void readsStoredLargeValueByRef() throws Exception
    {
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 4, 5);
        store.registerExecution("exec-1", "file-1");
        QueryLargeValueCell large = (QueryLargeValueCell) store.storeText("exec-1", "json", "application/json", "{\"abcdef\":true}");
        EnvelopeCodec codec = new EnvelopeCodec(MapperUtils.MAPPER);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        QueryLargeValueReadRequestHandler handler = new QueryLargeValueReadRequestHandler(new ResponseWriter(output, codec), codec, store);

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-1", null, "queryengine.largeValue.read", Map.of("ref", large.ref()), null, null));

        BackendEnvelope response = decode(codec, output.toByteArray());
        Assertions.assertNull(response.error());
        QueryLargeValueReadResult result = MapperUtils.MAPPER.convertValue(response.result(), QueryLargeValueReadResult.class);
        Assertions.assertEquals(large.ref(), result.ref());
        Assertions.assertEquals("{\"abcdef\":true}", result.content());
        Assertions.assertEquals("application/json", result.contentType());
    }

    @Test
    void returnsNotFoundForMissingRef() throws Exception
    {
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 4, 5);
        EnvelopeCodec codec = new EnvelopeCodec(MapperUtils.MAPPER);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        QueryLargeValueReadRequestHandler handler = new QueryLargeValueReadRequestHandler(new ResponseWriter(output, codec), codec, store);

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-1", null, "queryengine.largeValue.read", Map.of("ref", "missing"), null, null));

        BackendEnvelope response = decode(codec, output.toByteArray());
        Assertions.assertNull(response.result());
        Assertions.assertEquals(BackendErrorCode.LARGE_VALUE_NOT_FOUND, response.error()
                .code());
    }

    @Test
    void returnsValidationForMissingParams() throws Exception
    {
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 4, 5);
        EnvelopeCodec codec = new EnvelopeCodec(MapperUtils.MAPPER);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        QueryLargeValueReadRequestHandler handler = new QueryLargeValueReadRequestHandler(new ResponseWriter(output, codec), codec, store);

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-1", null, "queryengine.largeValue.read", null, null, null));

        BackendEnvelope response = decode(codec, output.toByteArray());
        Assertions.assertNull(response.result());
        Assertions.assertEquals(BackendErrorCode.VALIDATION, response.error()
                .code());
    }

    @Test
    void returnsValidationForMalformedParams() throws Exception
    {
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 4, 5);
        EnvelopeCodec codec = new EnvelopeCodec(MapperUtils.MAPPER);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        QueryLargeValueReadRequestHandler handler = new QueryLargeValueReadRequestHandler(new ResponseWriter(output, codec), codec, store);

        handler.handle(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-1", null, "queryengine.largeValue.read", "not-an-object", null, null));

        BackendEnvelope response = decode(codec, output.toByteArray());
        Assertions.assertNull(response.result());
        Assertions.assertEquals(BackendErrorCode.VALIDATION, response.error()
                .code());
    }

    private static BackendEnvelope decode(EnvelopeCodec codec, byte[] payload) throws Exception
    {
        String frame = new String(payload, StandardCharsets.UTF_8);
        int bodyStart = frame.indexOf("\r\n\r\n");
        if (bodyStart < 0)
        {
            bodyStart = frame.indexOf("\n\n");
            bodyStart += 2;
        }
        else
        {
            bodyStart += 4;
        }
        return codec.decode(frame.substring(bodyStart));
    }
}
