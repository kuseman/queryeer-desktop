package com.queryeer.backend.transport.stdio;

import java.util.function.Supplier;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.runtime.RuntimeStatusParams;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;

public final class RuntimeStatusRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final Supplier<RuntimeStatusResult> snapshotSupplier;

    public RuntimeStatusRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, Supplier<RuntimeStatusResult> snapshotSupplier)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.snapshotSupplier = snapshotSupplier;
    }

    @Override
    public String method()
    {
        return "backend.runtimeStatus";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        RuntimeStatusParams params = codec.objectMapper()
                .convertValue(envelope.params(), RuntimeStatusParams.class);

        RuntimeStatusResult snapshot = snapshotSupplier.get();
        RuntimeStatusResult result = snapshot;
        if (params == null
                || !Boolean.TRUE.equals(params.includeCapabilities()))
        {
            result = new RuntimeStatusResult(snapshot.startedAt(), snapshot.pluginStatuses(), snapshot.activatedPluginIds(), null);
        }

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, result, null));
    }
}
