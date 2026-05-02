package com.queryeer.backend.queryengine.jdbc;

public interface JdbcDialect
{
    JdbcDialectMetadata metadata();

    JdbcConnectionSetupDefinition connectionSetup();

    JdbcQueryExecutor queryExecutor();

    JdbcSchemaResolver schemaResolver();

    /**
     * Returns {@code true} if this dialect requires an explicit JDBC URL in the connection configuration, or {@code false} if the dialect constructs the URL itself from structured connection fields
     * (host, port, database, etc.).
     */
    default boolean requiresExplicitUrl()
    {
        return true;
    }
}
