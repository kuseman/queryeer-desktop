package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.security.SecuritySessionCloseResult;

final class SecuritySessionCloseRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final SecuritySessionBridge securityBridge;
    private final EventBus events;

    public SecuritySessionCloseRequestHandler(ResponseWriter responseWriter, SecuritySessionBridge securityBridge, EventBus events)
    {
        this.responseWriter = responseWriter;
        this.securityBridge = securityBridge;
        this.events = events;
    }

    @Override
    public String method()
    {
        return "security.session.close";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        securityBridge.closeSession();
        events.publish("security.session.closed", java.util.Map.of());

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new SecuritySessionCloseResult(true), null));
    }
}
