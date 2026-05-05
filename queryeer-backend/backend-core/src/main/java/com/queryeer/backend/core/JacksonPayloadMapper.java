package com.queryeer.backend.core;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.PayloadMapper;

record JacksonPayloadMapper(ObjectMapper objectMapper) implements PayloadMapper
{
    @Override
    public <T> T convert(Object fromValue, Class<T> toValueType)
    {
        return objectMapper.convertValue(fromValue, toValueType);
    }
}
