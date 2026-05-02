package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaResolver;

final class SqlServerSchemaResolver implements JdbcSchemaResolver
{
    @Override
    public List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection)
    {
        return resolveSchema(connection, Map.of());
    }

    @Override
    public List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection, Map<String, Object> options)
    {
        String scope = options.containsKey("scope") ? String.valueOf(options.get("scope"))
                : "top";
        Map<String, Object> target = options.containsKey("target") ? asMap(options.get("target"))
                : Map.of();

        String url = SqlServerUrlBuilder.buildUrl(connection.properties());
        Properties props = SqlServerUrlBuilder.buildConnectionProperties(connection.properties());

        try (Connection jdbcConnection = DriverManager.getConnection(url, props))
        {
            return switch (scope)
            {
                case "tables" -> resolveTablesScope(jdbcConnection, target);
                case "columns" -> resolveColumnsScope(jdbcConnection, target);
                default -> resolveTopScope(jdbcConnection);
            };
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Schema resolution failed: " + e.getMessage(), e);
        }
    }

    private List<JdbcSchemaObject> resolveTopScope(Connection connection) throws SQLException
    {
        DatabaseMetaData meta = connection.getMetaData();
        List<JdbcSchemaObject> databases = new ArrayList<>();
        try (ResultSet catalogs = meta.getCatalogs())
        {
            while (catalogs.next())
            {
                String catalog = catalogs.getString("TABLE_CAT");
                databases.add(new JdbcSchemaObject(catalog, catalog, "database", null, Map.of()));
            }
        }
        return databases;
    }

    private List<JdbcSchemaObject> resolveTablesScope(Connection connection, Map<String, Object> target) throws SQLException
    {
        DatabaseMetaData meta = connection.getMetaData();
        String catalog = text(target.get("database"));
        String schema = text(target.get("schema"));

        List<JdbcSchemaObject> schemas = new ArrayList<>();

        if (catalog != null
                && schema == null)
        {
            // return schemas for this catalog
            try (ResultSet rs = meta.getSchemas(catalog, null))
            {
                while (rs.next())
                {
                    String schemaName = rs.getString("TABLE_SCHEM");
                    schemas.add(new JdbcSchemaObject(catalog + "." + schemaName, schemaName, "schema", null, Map.of()));
                }
            }
            return schemas;
        }

        List<JdbcSchemaObject> tables = new ArrayList<>();
        try (ResultSet rs = meta.getTables(catalog, schema, null, new String[] { "TABLE", "VIEW" }))
        {
            while (rs.next())
            {
                String tableName = rs.getString("TABLE_NAME");
                String tableType = rs.getString("TABLE_TYPE");
                String kind = "VIEW".equalsIgnoreCase(tableType) ? "view"
                        : "table";
                String id = (catalog != null ? catalog + "."
                        : "")
                        + (schema != null ? schema + "."
                                : "")
                        + tableName;
                tables.add(new JdbcSchemaObject(id, tableName, kind, null, Map.of()));
            }
        }
        return tables;
    }

    private List<JdbcSchemaObject> resolveColumnsScope(Connection connection, Map<String, Object> target) throws SQLException
    {
        DatabaseMetaData meta = connection.getMetaData();
        String catalog = text(target.get("database"));
        String schema = text(target.get("schema"));
        String table = text(target.get("table"));

        List<JdbcSchemaObject> columns = new ArrayList<>();
        try (ResultSet rs = meta.getColumns(catalog, schema, table, null))
        {
            while (rs.next())
            {
                String columnName = rs.getString("COLUMN_NAME");
                String typeName = rs.getString("TYPE_NAME");
                String id = (catalog != null ? catalog + "."
                        : "")
                        + (schema != null ? schema + "."
                                : "")
                        + (table != null ? table + "."
                                : "")
                        + columnName;
                columns.add(new JdbcSchemaObject(id, columnName, "column", null, Map.of("type", typeName == null ? "unknown"
                        : typeName.toLowerCase())));
            }
        }
        return columns;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value)
    {
        if (value instanceof Map<?, ?> map)
        {
            return (Map<String, Object>) map;
        }
        return Map.of();
    }

    private static String text(Object value)
    {
        if (value instanceof String s)
        {
            String trimmed = s.trim();
            return trimmed.isBlank() ? null
                    : trimmed;
        }
        return null;
    }
}
