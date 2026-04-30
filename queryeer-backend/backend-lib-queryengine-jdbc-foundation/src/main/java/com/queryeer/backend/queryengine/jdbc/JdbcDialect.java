package com.queryeer.backend.queryengine.jdbc;

public interface JdbcDialect
{
    JdbcDialectMetadata metadata();

    JdbcConnectionSetupDefinition connectionSetup();

    JdbcQueryExecutor queryExecutor();

    JdbcSchemaResolver schemaResolver();
}
