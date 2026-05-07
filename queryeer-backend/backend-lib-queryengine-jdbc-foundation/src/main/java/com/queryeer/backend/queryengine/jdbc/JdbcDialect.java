package com.queryeer.backend.queryengine.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.Map;
import java.util.Properties;

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

    /**
     * Resolves an identifier for the current RDBMS session backing this JDBC connection.
     */
    default String resolveSessionId(Connection connection) throws SQLException
    {
        return "";
    }

    /**
     * Extracts known error details from a driver-specific exception chain.
     */
    default Map<String, Object> extractErrorDetails(Throwable throwable)
    {
        return new HashMap<>();
    }

    /**
     * Opens a JDBC connection used for file-scoped session management.
     */
    default Connection openSessionConnection(JdbcConnectionProfile profile) throws SQLException
    {
        Map<String, Object> props = profile.properties();
        String url = text(props, "url");
        if (url == null)
        {
            throw new IllegalArgumentException("Connection profile has no url");
        }
        Properties properties = new Properties();
        String username = text(props, "username");
        if (username != null)
        {
            properties.setProperty("user", username);
        }
        String password = text(props, "password");
        if (password != null)
        {
            properties.setProperty("password", password);
        }
        return DriverManager.getConnection(url, properties);
    }

    private static String text(Map<String, Object> properties, String key)
    {
        Object value = properties.get(key);
        if (value instanceof String s)
        {
            String trimmed = s.trim();
            return trimmed.isEmpty() ? null
                    : trimmed;
        }
        return null;
    }
}
