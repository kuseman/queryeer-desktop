package com.queryeer.backend.core;

import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.type.CollectionType;
import com.fasterxml.jackson.databind.type.TypeFactory;
import com.queryeer.backend.api.PayloadMapper;

public record JacksonPayloadMapper(ObjectMapper objectMapper) implements PayloadMapper
{
    @Override
    public <T> T convert(Object fromValue, Class<T> toValueType)
    {
        return objectMapper.convertValue(fromValue, toValueType);
    }

    @Override
    public <T> List<T> convertToList(Object fromValue, Class<T> toValueType)
    {
        if (fromValue == null)
        {
            return List.of();
        }
        @SuppressWarnings("unchecked")
        List<Object> list = fromValue instanceof List lst ? lst
                : List.of(fromValue);
        CollectionType type = TypeFactory.defaultInstance()
                .constructCollectionType(List.class, toValueType);
        return objectMapper.convertValue(list, type);
    }
}
