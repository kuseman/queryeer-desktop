package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.security.SecurityVaultChangedParams;
import com.queryeer.backend.contract.security.SecurityVaultChangedResult;

final class SecurityVaultChangedRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final SecuritySessionBridge securityBridge;

    public SecurityVaultChangedRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, SecuritySessionBridge securityBridge)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.securityBridge = securityBridge;
    }

    @Override
    public String method()
    {
        return "security.vault.changed";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        SecurityVaultChangedParams params = codec.objectMapper()
                .convertValue(envelope.params(), SecurityVaultChangedParams.class);
        if (params != null)
        {
            securityBridge.markVaultChanged(params.vaultPath(), params.vaultUpdatedAt());
        }

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new SecurityVaultChangedResult(true), null));
    }
}
