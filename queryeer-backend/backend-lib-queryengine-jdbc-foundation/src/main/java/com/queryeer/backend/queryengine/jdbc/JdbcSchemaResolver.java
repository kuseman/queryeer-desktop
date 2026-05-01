package com.queryeer.backend.queryengine.jdbc;

import java.util.List;
import java.util.Map;

public interface JdbcSchemaResolver
{
    List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection);

    default List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection, Map<String, Object> options)
    {
        return resolveSchema(connection);
    }
}
