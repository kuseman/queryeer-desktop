package com.queryeer.backend.transport.stdio;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;

class RequestDispatcherTest
{
    @Test
    void routesKnownMethodToRegisteredHandler()
    {
        ObjectMapper objectMapper = new ObjectMapper();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter responseWriter = new ResponseWriter(output, codec);

        RecordingRequestHandler handler = new RecordingRequestHandler("health.ping");
        RequestDispatcher dispatcher = new RequestDispatcher(responseWriter, List.of(handler));

        BackendEnvelope envelope = new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-1", null, "health.ping", null, null, null);
        dispatcher.dispatch(envelope);

        Assertions.assertEquals(1, handler.handledCount);
        Assertions.assertEquals("req-1", handler.lastEnvelope.id());
        Assertions.assertEquals(0, output.size());
    }

    @Test
    void returnsMethodNotFoundErrorForUnknownMethod() throws Exception
    {
        ObjectMapper objectMapper = new ObjectMapper();
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        EnvelopeCodec codec = new EnvelopeCodec(objectMapper);
        ResponseWriter responseWriter = new ResponseWriter(output, codec);

        RequestDispatcher dispatcher = new RequestDispatcher(responseWriter, List.of(new RecordingRequestHandler("health.ping")));

        BackendEnvelope envelope = new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.REQUEST, "req-2", null, "unknown.method", null, null, null);
        dispatcher.dispatch(envelope);

        FramedReader reader = new FramedReader(new ByteArrayInputStream(output.toByteArray()), _ ->
        {
        });
        BackendEnvelope response = codec.decode(reader.readFrame());

        Assertions.assertEquals(EnvelopeType.RESPONSE, response.type());
        Assertions.assertEquals("req-2", response.id());
        Assertions.assertNotNull(response.error());
        Assertions.assertEquals("METHOD_NOT_FOUND", response.error()
                .code()
                .name());
        Assertions.assertTrue(response.error()
                .message()
                .contains("Unknown method: unknown.method"));
        Assertions.assertNotNull(response.error()
                .details());
        Assertions.assertEquals("req-2", response.error()
                .details()
                .get("requestId"));
        Assertions.assertEquals("unknown.method", response.error()
                .details()
                .get("method"));
    }

    private static final class RecordingRequestHandler implements RequestHandler
    {
        private final String method;
        private int handledCount;
        private BackendEnvelope lastEnvelope;

        private RecordingRequestHandler(String method)
        {
            this.method = method;
        }

        @Override
        public String method()
        {
            return method;
        }

        @Override
        public void handle(BackendEnvelope envelope)
        {
            handledCount++;
            lastEnvelope = envelope;
        }
    }
}
