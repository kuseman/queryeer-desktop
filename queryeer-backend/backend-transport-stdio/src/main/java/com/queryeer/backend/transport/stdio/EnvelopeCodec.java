package com.queryeer.backend.transport.stdio;

import com.queryeer.backend.contract.BackendEnvelope;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

final class EnvelopeCodec
{
    private final ObjectMapper objectMapper;

    public EnvelopeCodec(ObjectMapper objectMapper)
    {
        this.objectMapper = objectMapper;
    }

    public BackendEnvelope decode(String line) throws JacksonException
    {
        return objectMapper.readValue(line, BackendEnvelope.class);
    }

    public String encode(BackendEnvelope envelope) throws JacksonException
    {
        return objectMapper.writeValueAsString(envelope);
    }

    public ObjectMapper objectMapper()
    {
        return objectMapper;
    }
}
