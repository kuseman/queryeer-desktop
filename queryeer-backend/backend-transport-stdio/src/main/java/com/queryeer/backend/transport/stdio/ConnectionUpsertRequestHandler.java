package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.connection.ConnectionUpsertParams;
import com.queryeer.backend.contract.connection.ConnectionUpsertResult;

final class ConnectionUpsertRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final QueryEngineRegistry queryEngines;

    public ConnectionUpsertRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, QueryEngineRegistry queryEngines)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.queryEngines = queryEngines;
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

        String connectionId = params.connectionId();
        if (connectionId == null
                || connectionId.isBlank())
        {
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, null,
                    new BackendError(BackendErrorCode.VALIDATION, "connectionId is required", null)));
            return;
        }

        QueryEngineProvider provider = queryEngines.getProvider(params.engineId());
        if (provider == null)
        {
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, null,
                    new BackendError(BackendErrorCode.ENGINE_NOT_FOUND, "No engine registered for id: " + params.engineId(), null)));
            return;
        }

        ConnectionUpsertParams paramsWithConnectionId = new ConnectionUpsertParams(connectionId, params.engineId(), params.name(), params.connection());
        Object result = provider.invoke(null, "connection.upsert", paramsWithConnectionId);

        long version = 1L;
        if (result instanceof ConnectionUpsertResult upsertResult)
        {
            version = upsertResult.version();
        }
        else if (result instanceof java.util.Map<?, ?> map
                && map.get("version") instanceof Number number)
        {
            version = number.longValue();
        }

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new ConnectionUpsertResult(connectionId, version), null));
    }
}
