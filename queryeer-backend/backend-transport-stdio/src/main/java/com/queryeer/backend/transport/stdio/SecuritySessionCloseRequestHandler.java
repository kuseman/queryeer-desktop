package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.security.SecuritySessionCloseResult;
import com.queryeer.backend.core.security.SecuritySession;

final class SecuritySessionCloseRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final SecuritySession securitySession;
    private final EventBus events;

    public SecuritySessionCloseRequestHandler(ResponseWriter responseWriter, SecuritySession securitySession, EventBus events)
    {
        this.responseWriter = responseWriter;
        this.securitySession = securitySession;
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
        securitySession.closeSession();
        events.publish("security.session.closed", java.util.Map.of());

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new SecuritySessionCloseResult(true), null));
    }
}
