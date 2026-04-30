package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;

final class NotificationPublisher
{
    private final ResponseWriter responseWriter;

    public NotificationPublisher(ResponseWriter responseWriter)
    {
        this.responseWriter = responseWriter;
    }

    public void publish(String method, Object params)
    {
        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, null, method, params, null, null));
    }

    public void publishForQuery(String queryId, String method, Object params)
    {
        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, queryId, method, params, null, null));
    }
}
