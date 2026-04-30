package com.queryeer.backend.transport.stdio;

import java.time.Instant;

import com.queryeer.backend.contract.BackendEnvelope;
import com.queryeer.backend.contract.EnvelopeType;
import com.queryeer.backend.contract.ProtocolVersion;
import com.queryeer.backend.contract.health.PingParams;
import com.queryeer.backend.contract.health.PingResult;

final class HealthPingRequestHandler implements RequestHandler
{
    private final long startedAt;
    private final ResponseWriter responseWriter;
    private final EnvelopeCodec codec;
    private final JavaDebugPortDetector debugPortDetector;

    public HealthPingRequestHandler(long startedAt, ResponseWriter responseWriter, EnvelopeCodec codec)
    {
        this.startedAt = startedAt;
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.debugPortDetector = new JavaDebugPortDetector();
    }

    @Override
    public String method()
    {
        return "health.ping";
    }

    @Override
    public void handle(BackendEnvelope envelope)
    {
        PingParams params = codec.objectMapper()
                .convertValue(envelope.params(), PingParams.class);

        PingResult result = new PingResult(params.timestamp() == null ? Instant.now()
                .toString()
                : params.timestamp(), System.currentTimeMillis() - startedAt, debugPortDetector.detect());

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, result, null));
    }
}
