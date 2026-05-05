package com.queryeer.backend.queryengine.jdbc;

import java.sql.Connection;
import java.sql.SQLException;

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

    /**
     * Switches the given connection to the requested database/catalog before executing statements. Default implementation uses {@link Connection#setCatalog(String)}.
     */
    default void applyDatabase(Connection connection, String database) throws SQLException
    {
        connection.setCatalog(database);
    }

    /**
     * Reads the currently active database/catalog from the connection after execution so the frontend can stay in sync. Default implementation uses {@link Connection#getCatalog()}.
     */
    default String resolveCurrentDatabase(Connection connection) throws SQLException
    {
        return connection.getCatalog();
    }
}
