package com.queryeer.backend.queryengine.jdbc;

import static com.queryeer.backend.api.PayloadUtils.stringValue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;

public interface JdbcDialect
{
    String DEFAULT_SQL_GRAMMAR_ID = "postgres";

    JdbcDialectMetadata metadata();

    JdbcQueryExecutor queryExecutor();

    /**
     * Returns per-parentKind schema resolvers that override the default behavior. Keys are parentKind strings (e.g. "tables_folder", "schema"). Parent kinds not present in the map fall through to the
     * default resolver.
     */
    default Map<String, JdbcSchemaResolver> branchResolvers()
    {
        return Map.of();
    }

    /**
     * Returns additional tree branches contributed by this dialect. Branches can attach at the connection level (siblings of databases_container) or at the schema level (additional folders alongside
     * tables_folder, views_folder).
     */
    default List<JdbcTreeBranch> treeBranches()
    {
        return List.of();
    }

    /**
     * Grammar identifier used by SQL parser services.
     */
    default String sqlGrammarId()
    {
        return DEFAULT_SQL_GRAMMAR_ID;
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
    default Connection openSessionConnection(Map<String, Object> materializedProperties) throws SQLException
    {
        String url = buildUrl(materializedProperties);
        if (url == null)
        {
            throw new IllegalArgumentException("Connection profile has no url");
        }
        Properties properties = new Properties();
        String username = stringValue(materializedProperties, JdbcConnection.KEY_USERNAME);
        if (username != null)
        {
            properties.setProperty("user", username);
        }
        String password = stringValue(materializedProperties, JdbcConnection.KEY_PASSWORD);
        if (password != null)
        {
            properties.setProperty("password", password);
        }
        int previousLoginTimeout = DriverManager.getLoginTimeout();
        DriverManager.setLoginTimeout(15);
        try
        {
            return DriverManager.getConnection(url, properties);
        }
        finally
        {
            DriverManager.setLoginTimeout(previousLoginTimeout);
        }
    }

    /**
     * Builds JDBC URL from a materialized connection property map.
     */
    String buildUrl(Map<String, Object> materializedProperties);
}
