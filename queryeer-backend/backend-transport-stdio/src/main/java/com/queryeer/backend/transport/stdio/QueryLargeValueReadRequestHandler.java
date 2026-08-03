package com.queryeer.backend.transport.stdio;

import java.util.Map;

import com.queryeer.backend.api.LargeValueStore;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.query.QueryLargeValueReadParams;
import com.queryeer.backend.contract.query.QueryLargeValueReadResult;

import tools.jackson.core.JacksonException;

final class QueryLargeValueReadRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final LargeValueStore largeValueStore;

    QueryLargeValueReadRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, LargeValueStore largeValueStore)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.largeValueStore = largeValueStore;
    }

    @Override
    public String method()
    {
        return "queryengine.largeValue.read";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        QueryLargeValueReadParams params;
        try
        {
            params = codec.objectMapper()
                    .convertValue(envelope.params(), QueryLargeValueReadParams.class);
        }
        catch (IllegalArgumentException | JacksonException e)
        {
            writeError(envelope.id(), BackendErrorCode.VALIDATION, "large value params are invalid", Map.of());
            return;
        }
        if (params == null)
        {
            writeError(envelope.id(), BackendErrorCode.VALIDATION, "large value params are required", Map.of());
            return;
        }
        if (params.ref() == null
                || params.ref()
                        .isBlank())
        {
            writeError(envelope.id(), BackendErrorCode.VALIDATION, "large value ref is required", Map.of());
            return;
        }

        try
        {
            QueryLargeValueReadResult result = largeValueStore.read(params.ref());
            if (result == null)
            {
                writeError(envelope.id(), BackendErrorCode.LARGE_VALUE_NOT_FOUND, "Large value not found", Map.of("ref", params.ref()));
                return;
            }
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, result, null));
        }
        catch (Exception e)
        {
            writeError(envelope.id(), BackendErrorCode.INTERNAL, "Could not read large value", Map.of("ref", params.ref()));
        }
    }

    private void writeError(String id, BackendErrorCode code, String message, Map<String, Object> details)
    {
        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, id, null, null, null, null, new BackendError(code, message, details)));
    }
}
