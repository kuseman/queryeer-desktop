package com.queryeer.backend.queryengine.jdbc;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class JdbcSchemaObjectFactory
{
    private static final String KIND_COLUMN = "column";
    private static final String KEY_TYPE = "type";
    private static final String KEY_NULLABLE = "nullable";
    private static final String KEY_ORDINAL = "ordinal";
    private static final String KEY_SIZE = "size";
    private static final String KEY_PRECISION = "precision";
    private static final String KEY_SCALE = "scale";
    private static final String UNKNOWN_TYPE = "unknown";

    public static JdbcSchemaObject column(String id, JdbcColumnDefinition definition)
    {
        Map<String, Object> attributes = new LinkedHashMap<>();
        attributes.put(KEY_TYPE, normalizeType(definition.typeName()));
        if (definition.nullable() != null)
        {
            attributes.put(KEY_NULLABLE, definition.nullable());
        }
        if (definition.ordinal() != null)
        {
            attributes.put(KEY_ORDINAL, definition.ordinal());
        }
        if (definition.size() != null)
        {
            attributes.put(KEY_SIZE, definition.size());
        }
        if (definition.precision() != null)
        {
            attributes.put(KEY_PRECISION, definition.precision());
        }
        if (definition.scale() != null)
        {
            attributes.put(KEY_SCALE, definition.scale());
        }
        return new JdbcSchemaObject(id, definition.name(), KIND_COLUMN, List.of(), Map.copyOf(attributes));
    }

    private static String normalizeType(String typeName)
    {
        if (typeName == null)
        {
            return UNKNOWN_TYPE;
        }
        String trimmed = typeName.trim();
        return trimmed.isBlank() ? UNKNOWN_TYPE
                : trimmed.toLowerCase();
    }

    private JdbcSchemaObjectFactory()
    {
    }
}
