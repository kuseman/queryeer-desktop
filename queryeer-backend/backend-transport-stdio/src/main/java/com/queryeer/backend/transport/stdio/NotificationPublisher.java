package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;

public final class NotificationPublisher
{
    private final ResponseWriter responseWriter;

    public NotificationPublisher(ResponseWriter responseWriter)
    {
        this.responseWriter = responseWriter;
    }

    public void publish(String method, Object params)
    {
        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.NOTIFICATION, null, method, params, null, null));
    }
}
