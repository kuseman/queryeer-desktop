package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.credential.CredentialStoreParams;
import com.queryeer.backend.contract.credential.CredentialStoreResult;

public final class CredentialStoreRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;

    public CredentialStoreRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
    }

    @Override
    public String method()
    {
        return "credential.store";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        CredentialStoreParams params = codec.objectMapper()
                .convertValue(envelope.params(), CredentialStoreParams.class);

        String credentialId = "cred-" + envelope.id();
        responseWriter
                .write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new CredentialStoreResult(params.connectionId(), credentialId, 1L), null));
    }
}
