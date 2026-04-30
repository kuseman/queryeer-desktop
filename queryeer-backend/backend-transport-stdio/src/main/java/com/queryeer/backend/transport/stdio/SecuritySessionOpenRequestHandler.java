package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.security.SecuritySessionOpenParams;
import com.queryeer.backend.contract.security.SecuritySessionOpenResult;

final class SecuritySessionOpenRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final SecuritySessionBridge securityBridge;

    public SecuritySessionOpenRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, SecuritySessionBridge securityBridge)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.securityBridge = securityBridge;
    }

    @Override
    public String method()
    {
        return "security.session.open";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        SecuritySessionOpenParams params = codec.objectMapper()
                .convertValue(envelope.params(), SecuritySessionOpenParams.class);

        if (params != null)
        {
            securityBridge.openSession(params.sessionId(), params.vaultPath(), params.sessionKeyBase64(), params.vaultUpdatedAt());
        }

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new SecuritySessionOpenResult(true), null));
    }
}
