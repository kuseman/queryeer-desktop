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
    private static final String OPTION_SCOPE = "scope";
    private static final String OPTION_TARGET = "target";
    private static final String SCOPE_TOP = "top";
    private static final String SCOPE_TABLES = "tables";
    private static final String SCOPE_COLUMNS = "columns";
    private static final String KIND_DATABASE = "database";
    private static final String KIND_SCHEMA = "schema";
    private static final String KIND_TABLE = "table";
    private static final String KIND_VIEW = "view";
    private static final String KIND_COLUMN = "column";
    private static final String KEY_TYPE = "type";
    private static final String UNKNOWN_TYPE = "unknown";
    private static final String KEY_DATABASE = "database";
    private static final String KEY_SCHEMA = "schema";
    private static final String KEY_TABLE = "table";
    private static final String ERROR_SCHEMA_RESOLUTION = "Schema resolution failed: ";

    @Override
    public List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection)
    {
        return resolveSchema(connection, Map.of());
    }

    @Override
    public List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection, Map<String, Object> options)
    {
        String scope = options.containsKey(OPTION_SCOPE) ? String.valueOf(options.get(OPTION_SCOPE))
                : SCOPE_TOP;
        com.queryeer.backend.contract.jdbc.JdbcSchemaTarget target = extractTarget(options.get(OPTION_TARGET));

        String url = SqlServerUrlBuilder.buildUrl(connection.properties());
        Properties props = SqlServerUrlBuilder.buildConnectionProperties(connection.properties());

        try (Connection jdbcConnection = DriverManager.getConnection(url, props))
        {
            return switch (scope)
            {
                case SCOPE_TABLES -> resolveTablesScope(jdbcConnection, target);
                case SCOPE_COLUMNS -> resolveColumnsScope(jdbcConnection, target);
                default -> resolveTopScope(jdbcConnection);
            };
        }
        catch (SQLException e)
        {
            throw new RuntimeException(ERROR_SCHEMA_RESOLUTION + e.getMessage(), e);
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
                databases.add(new JdbcSchemaObject(catalog, catalog, KIND_DATABASE, null, Map.of()));
            }
        }
        return databases;
    }

    private List<JdbcSchemaObject> resolveTablesScope(Connection connection, com.queryeer.backend.contract.jdbc.JdbcSchemaTarget target) throws SQLException
    {
        DatabaseMetaData meta = connection.getMetaData();
        String catalog = target != null ? trimToNull(target.database())
                : null;
        String schema = target != null ? trimToNull(target.schema())
                : null;

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
                    schemas.add(new JdbcSchemaObject(catalog + "." + schemaName, schemaName, KIND_SCHEMA, null, Map.of()));
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
                String kind = "VIEW".equalsIgnoreCase(tableType) ? KIND_VIEW
                        : KIND_TABLE;
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

    private List<JdbcSchemaObject> resolveColumnsScope(Connection connection, com.queryeer.backend.contract.jdbc.JdbcSchemaTarget target) throws SQLException
    {
        DatabaseMetaData meta = connection.getMetaData();
        String catalog = target != null ? trimToNull(target.database())
                : null;
        String schema = target != null ? trimToNull(target.schema())
                : null;
        String table = target != null ? trimToNull(target.table())
                : null;

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
                columns.add(new JdbcSchemaObject(id, columnName, KIND_COLUMN, null, Map.of(KEY_TYPE, typeName == null ? UNKNOWN_TYPE
                        : typeName.toLowerCase())));
            }
        }
        return columns;
    }

    private static com.queryeer.backend.contract.jdbc.JdbcSchemaTarget extractTarget(Object value)
    {
        if (value instanceof com.queryeer.backend.contract.jdbc.JdbcSchemaTarget t)
        {
            return t;
        }
        if (value instanceof Map<?, ?> map)
        {
            String database = map.get(KEY_DATABASE) instanceof String s ? trimToNull(s)
                    : null;
            String schema = map.get(KEY_SCHEMA) instanceof String s ? trimToNull(s)
                    : null;
            String table = map.get(KEY_TABLE) instanceof String s ? trimToNull(s)
                    : null;
            return new com.queryeer.backend.contract.jdbc.JdbcSchemaTarget(database, schema, table);
        }
        return null;
    }

    private static String trimToNull(String value)
    {
        if (value == null)
        {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isBlank() ? null
                : trimmed;
    }
}
