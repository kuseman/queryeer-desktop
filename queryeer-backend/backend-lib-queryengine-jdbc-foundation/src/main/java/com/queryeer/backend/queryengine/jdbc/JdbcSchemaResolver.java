package com.queryeer.backend.queryengine.jdbc;

import java.util.List;

public interface JdbcSchemaResolver
{
    List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection);
}
