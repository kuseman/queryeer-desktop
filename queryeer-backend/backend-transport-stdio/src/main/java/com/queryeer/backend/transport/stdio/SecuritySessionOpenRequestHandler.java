package com.queryeer.backend.transport.stdio;

import java.util.LinkedHashMap;
import java.util.Map;

import com.queryeer.backend.api.EventBus;
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
    private final EventBus events;

    public SecuritySessionOpenRequestHandler(ResponseWriter responseWriter, EnvelopeCodec codec, SecuritySessionBridge securityBridge, EventBus events)
    {
        this.responseWriter = responseWriter;
        this.codec = codec;
        this.securityBridge = securityBridge;
        this.events = events;
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
            Map<String, Object> event = new LinkedHashMap<>();
            event.put("sessionId", params.sessionId());
            event.put("vaultPath", params.vaultPath());
            event.put("vaultUpdatedAt", params.vaultUpdatedAt());
            events.publish("security.session.opened", event);
        }

        responseWriter.write(new BackendEnvelope(ProtocolVersion.V1_0_0, EnvelopeType.RESPONSE, envelope.id(), null, null, null, new SecuritySessionOpenResult(true), null));
    }
}
