package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.security.SecuritySessionCloseResult;

public final class SecuritySessionCloseRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final SecuritySessionBridge securityBridge;

    public SecuritySessionCloseRequestHandler(ResponseWriter responseWriter, SecuritySessionBridge securityBridge)
    {
        this.responseWriter = responseWriter;
        this.securityBridge = securityBridge;
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

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new SecuritySessionCloseResult(true), null));
    }
}
