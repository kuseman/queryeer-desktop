package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.engine.EngineInvokeParams;
import com.queryeer.backend.contract.engine.EngineInvokeResult;

final class EngineInvokeRequestHandler implements RequestHandler
{
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final EngineInvokeService invokeService;

    public EngineInvokeRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, EngineInvokeService invokeService)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.invokeService = invokeService;
    }

    @Override
    public String method()
    {
        return "queryengine.invoke";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        EngineInvokeParams params = codec.objectMapper()
                .convertValue(envelope.params(), EngineInvokeParams.class);

        try
        {
            Object result = invokeService.invoke(params);
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new EngineInvokeResult(result), null));
        }
        catch (EngineInvokeService.EngineInvokeException e)
        {
            responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, null, new BackendError(e.code(), e.getMessage(), null)));
        }
    }
}
