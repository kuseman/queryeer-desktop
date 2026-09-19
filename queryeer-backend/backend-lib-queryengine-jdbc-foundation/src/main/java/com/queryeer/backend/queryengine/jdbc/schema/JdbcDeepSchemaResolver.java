package com.queryeer.backend.queryengine.jdbc.schema;

import java.util.List;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;

@FunctionalInterface
public interface JdbcDeepSchemaResolver
{
    List<JdbcSchemaObject> resolveDeepSchema(JdbcConnection connection, JdbcSchemaTarget target);
}
