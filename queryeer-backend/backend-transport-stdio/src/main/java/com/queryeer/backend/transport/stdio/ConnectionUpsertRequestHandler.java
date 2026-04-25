package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.connection.ConnectionCredentialStatus;
import com.queryeer.backend.contract.connection.ConnectionUpsertParams;
import com.queryeer.backend.contract.connection.ConnectionUpsertResult;

public final class ConnectionUpsertRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;

    public ConnectionUpsertRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
    }

    @Override
    public String method()
    {
        return "connection.upsert";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        ConnectionUpsertParams params = codec.objectMapper()
                .convertValue(envelope.params(), ConnectionUpsertParams.class);

        String connectionId = params.connectionId() == null
                || params.connectionId()
                        .isBlank() ? "conn-" + envelope.id()
                                : params.connectionId();

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null,
                new ConnectionUpsertResult(connectionId, 1L, ConnectionCredentialStatus.MISSING), null));
    }
}
