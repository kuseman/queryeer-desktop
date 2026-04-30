package com.queryeer.backend.transport.stdio;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;

final class RequestDispatcher
{
    private final ResponseWriter responseWriter;
    private final Map<String, RequestHandler> handlersByMethod;

    public RequestDispatcher(ResponseWriter responseWriter, List<RequestHandler> handlers)
    {
        this.responseWriter = responseWriter;
        this.handlersByMethod = indexHandlers(handlers);
    }

    public void dispatch(BackendEnvelope envelope)
    {
        if (envelope.type() != EnvelopeType.REQUEST)
        {
            return;
        }

        RequestHandler handler = handlersByMethod.get(envelope.method());
        if (handler == null)
        {
            String requestId = envelope.id() == null ? "unknown"
                    : envelope.id();
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, null,
                    new BackendError(BackendErrorCode.METHOD_NOT_FOUND, "Unknown method: " + envelope.method(), Map.of("requestId", requestId, "method", envelope.method()))));
            return;
        }

        handler.handle(envelope);
    }

    private Map<String, RequestHandler> indexHandlers(List<RequestHandler> handlers)
    {
        Map<String, RequestHandler> map = new LinkedHashMap<>();
        for (RequestHandler handler : handlers)
        {
            map.put(handler.method(), handler);
        }
        return Map.copyOf(map);
    }
}
