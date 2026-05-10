package com.queryeer.backend.plugin.jdbc;

import java.util.List;

import com.fasterxml.jackson.databind.type.CollectionType;
import com.fasterxml.jackson.databind.type.TypeFactory;
import com.queryeer.backend.api.PayloadMapper;

public class TestPayloadMapper implements PayloadMapper
{
    public static final PayloadMapper INSTANCE = new TestPayloadMapper();

    private TestPayloadMapper()
    {
    }

    @Override
    public <T> T convert(Object fromValue, Class<T> toValueType)
    {
        return MapperUtils.MAPPER.convertValue(fromValue, toValueType);
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
        return MapperUtils.MAPPER.convertValue(list, type);
    }

}
