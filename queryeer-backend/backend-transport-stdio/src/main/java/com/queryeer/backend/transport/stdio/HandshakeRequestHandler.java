package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.handshake.HandshakeResult;
import com.queryeer.backend.contract.handshake.ServerIdentity;

public final class HandshakeRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;

    public HandshakeRequestHandler(ResponseWriter responseWriter)
    {
        this.responseWriter = responseWriter;
    }

    @Override
    public String method()
    {
        return "backend.handshake";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        HandshakeResult result = new HandshakeResult(new ServerIdentity("queryeer-java-backend", "0.1.0"), ProtocolVersion.V1_0_0, BackendCapabilities.HANDSHAKE_SUPPORTED_CAPABILITIES);

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, result, null));
    }
}
