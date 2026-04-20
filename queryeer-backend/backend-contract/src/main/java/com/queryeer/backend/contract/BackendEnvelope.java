package com.queryeer.backend.contract;

public record BackendEnvelope(String protocolVersion, EnvelopeType type, String id, String method, Object params, Object result, BackendError error)
{
}
