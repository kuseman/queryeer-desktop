package com.queryeer.backend.queryengine.jdbc.schema;

import java.util.List;
import java.util.Map;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;

public interface JdbcSchemaResolver
{
    List<JdbcSchemaObject> resolveSchema(JdbcConnection connection, Map<String, Object> options);
}
