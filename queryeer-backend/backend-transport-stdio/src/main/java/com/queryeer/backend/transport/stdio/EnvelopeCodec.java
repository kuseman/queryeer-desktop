package com.queryeer.backend.transport.stdio;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.contract.BackendEnvelope;

final class EnvelopeCodec
{
    private final ObjectMapper objectMapper;

    public EnvelopeCodec(ObjectMapper objectMapper)
    {
        this.objectMapper = objectMapper;
    }

    public BackendEnvelope decode(String line) throws JsonProcessingException
    {
        return objectMapper.readValue(line, BackendEnvelope.class);
    }

    public String encode(BackendEnvelope envelope) throws JsonProcessingException
    {
        return objectMapper.writeValueAsString(envelope);
    }

    public ObjectMapper objectMapper()
    {
        return objectMapper;
    }
}
