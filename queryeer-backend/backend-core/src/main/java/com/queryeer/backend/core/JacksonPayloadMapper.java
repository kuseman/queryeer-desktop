package com.queryeer.backend.core;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.core.MapperUtils.MAPPER;

import java.util.List;

import com.queryeer.backend.api.PayloadMapper;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.type.CollectionType;

public record JacksonPayloadMapper() implements PayloadMapper
{
    @Override
    public <T> T convert(Object fromValue, Class<T> toValueType)
    {
        try
        {
            return MAPPER.convertValue(fromValue, toValueType);
        }
        catch (JacksonException e)
        {
            throw new IllegalArgumentException("Could not convert value to " + toValueType.getSimpleName() + ": " + e.getMessage(), e);
        }
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
        CollectionType type = MAPPER.getTypeFactory()
                .constructCollectionType(List.class, toValueType);
        try
        {
            return MAPPER.convertValue(list, type);
        }
        catch (JacksonException e)
        {
            throw new IllegalArgumentException("Could not convert list to " + toValueType.getSimpleName() + ": " + e.getMessage(), e);
        }
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
        catch (JacksonException e)
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
        catch (JacksonException e)
        {
            throw new RuntimeException("Error writing JSON from: " + value, e);
        }
    }
}
