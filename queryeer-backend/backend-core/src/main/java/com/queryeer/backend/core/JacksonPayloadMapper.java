package com.queryeer.backend.core;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.core.MapperUtils.MAPPER;

import java.util.List;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.type.CollectionType;
import com.fasterxml.jackson.databind.type.TypeFactory;
import com.queryeer.backend.api.PayloadMapper;

public record JacksonPayloadMapper() implements PayloadMapper
{
    @Override
    public <T> T convert(Object fromValue, Class<T> toValueType)
    {
        return MAPPER.convertValue(fromValue, toValueType);
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
        return MAPPER.convertValue(list, type);
    }

    @Override
    public <T> T parseJson(String json, Class<T> toValueType)
    {
        if (isBlank(json))
        {
            return null;
        }

        try
        {
            return MAPPER.readValue(json, toValueType);
        }
        catch (JsonProcessingException e)
        {
            throw new RuntimeException("Error reading JSON value: " + json, e);
        }
    }

    @Override
    public String writeJson(Object value)
    {
        try
        {
            return MAPPER.writeValueAsString(value);
        }
        catch (JsonProcessingException e)
        {
            throw new RuntimeException("Error writing JSON from: " + value, e);
        }
    }
}
