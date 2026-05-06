package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;

import com.queryeer.backend.contract.jdbc.JdbcSchemaTarget;
import com.queryeer.backend.queryengine.jdbc.JdbcColumnDefinition;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaObjectFactory;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaResolver;

final class SqlServerSchemaResolver implements JdbcSchemaResolver
{
    private static final String OPTION_SCOPE = "scope";
    private static final String OPTION_TARGET = "target";
    private static final String SCOPE_TOP = "top";
    private static final String SCOPE_DEEP = "deep";
    private static final String SCOPE_TABLES = "tables";
    private static final String SCOPE_COLUMNS = "columns";
    private static final String KIND_DATABASE = "database";
    private static final String KIND_SCHEMA = "schema";
    private static final String KIND_TABLE = "table";
    private static final String KIND_VIEW = "view";
    // private static final String KIND_COLUMN = "column";
    private static final String KEY_CATALOG = "catalog";
    private static final String KEY_DATABASE = "database";
    private static final String KEY_SCHEMA = "schema";
    private static final String KEY_TABLE = "table";
    private static final String ERROR_SCHEMA_RESOLUTION = "Schema resolution failed: ";
    private static final String SQL_TOP_DATABASES = """
            select d.name as database_name
            from sys.databases d
            where d.state = 0
            order by d.name
            """;
    private static final String SQL_SCHEMAS_BY_DATABASE = """
            select s.name as schema_name
            from sys.schemas s
            where s.schema_id < 16384
            order by s.name
            """;
    private static final String SQL_TABLES_AND_VIEWS = """
            select s.name as schema_name,
                   o.name as object_name,
                   o.type as object_type
            from sys.objects o
            join sys.schemas s on s.schema_id = o.schema_id
            where o.type in ('U','V')
              and o.is_ms_shipped = 0
              and (? is null or s.name = ?)
            order by s.name, o.name
            """;
    private static final String SQL_COLUMNS = """
            select s.name as schema_name,
                   o.name as object_name,
                   c.name as column_name,
                   t.name as type_name,
                   c.max_length as max_length,
                   c.precision as numeric_precision,
                   c.scale as numeric_scale,
                   c.is_nullable as is_nullable
            from sys.columns c
            join sys.objects o on o.object_id = c.object_id
            join sys.schemas s on s.schema_id = o.schema_id
            join sys.types t on t.user_type_id = c.user_type_id
            where o.type in ('U','V')
              and o.is_ms_shipped = 0
              and (? is null or s.name = ?)
              and (? is null or o.name = ?)
            order by s.name, o.name, c.column_id
            """;

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
        JdbcSchemaTarget target = extractTarget(options.get(OPTION_TARGET));

        String url = SqlServerUrlBuilder.buildUrl(connection.properties());
        Properties props = SqlServerUrlBuilder.buildConnectionProperties(connection.properties());

        try (Connection jdbcConnection = DriverManager.getConnection(url, props))
        {
            return switch (scope)
            {
                case SCOPE_DEEP -> resolveTablesScope(jdbcConnection, url, props, target);
                case SCOPE_TABLES -> resolveTablesScope(jdbcConnection, url, props, target);
                case SCOPE_COLUMNS -> resolveColumnsScope(jdbcConnection, url, props, target);
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
        List<JdbcSchemaObject> databases = new ArrayList<>();
        try (PreparedStatement statement = connection.prepareStatement(SQL_TOP_DATABASES); ResultSet resultSet = statement.executeQuery())
        {
            while (resultSet.next())
            {
                String catalog = resultSet.getString("database_name");
                databases.add(new JdbcSchemaObject(catalog, catalog, KIND_DATABASE, null, Map.of()));
            }
        }
        return databases;
    }

    private List<JdbcSchemaObject> resolveTablesScope(Connection connection, String url, Properties baseProps, JdbcSchemaTarget target) throws SQLException
    {
        String catalog = target != null ? trimToNull(target.database())
                : null;
        String schema = target != null ? trimToNull(target.schema())
                : null;

        List<JdbcSchemaObject> schemas = new ArrayList<>();

        if (catalog != null
                && schema == null)
        {
            try (Connection targetConnection = openForDatabase(url, baseProps, catalog);
                    PreparedStatement statement = targetConnection.prepareStatement(SQL_SCHEMAS_BY_DATABASE);
                    ResultSet rs = statement.executeQuery())
            {
                while (rs.next())
                {
                    String schemaName = rs.getString("schema_name");
                    schemas.add(new JdbcSchemaObject(catalog + "." + schemaName, schemaName, KIND_SCHEMA, null, Map.of(KEY_CATALOG, catalog)));
                }
            }
            return schemas;
        }

        List<JdbcSchemaObject> tables = new ArrayList<>();
        Connection source = catalog != null ? openForDatabase(url, baseProps, catalog)
                : connection;
        try (Connection targetConnection = source == connection ? null
                : source; PreparedStatement statement = source.prepareStatement(SQL_TABLES_AND_VIEWS))
        {
            statement.setString(1, schema);
            statement.setString(2, schema);
            try (ResultSet rs = statement.executeQuery())
            {
                while (rs.next())
                {
                    String schemaName = rs.getString("schema_name");
                    String tableName = rs.getString("object_name");
                    String objectType = rs.getString("object_type");
                    String kind = "V".equalsIgnoreCase(objectType) ? KIND_VIEW
                            : KIND_TABLE;
                    String id = (catalog != null ? catalog + "."
                            : "")
                            + (schemaName != null ? schemaName + "."
                                    : "")
                            + tableName;
                    Map<String, Object> attributes = new java.util.LinkedHashMap<>();
                    if (catalog != null)
                    {
                        attributes.put(KEY_CATALOG, catalog);
                    }
                    if (schemaName != null)
                    {
                        attributes.put(KEY_SCHEMA, schemaName);
                    }
                    tables.add(new JdbcSchemaObject(id, tableName, kind, null, Map.copyOf(attributes)));
                }
            }
        }
        return tables;
    }

    private List<JdbcSchemaObject> resolveColumnsScope(Connection connection, String url, Properties baseProps, com.queryeer.backend.contract.jdbc.JdbcSchemaTarget target) throws SQLException
    {
        String catalog = target != null ? trimToNull(target.database())
                : null;
        String schema = target != null ? trimToNull(target.schema())
                : null;
        String table = target != null ? trimToNull(target.table())
                : null;

        List<JdbcSchemaObject> columns = new ArrayList<>();
        Connection source = catalog != null ? openForDatabase(url, baseProps, catalog)
                : connection;
        try (Connection targetConnection = source == connection ? null
                : source; PreparedStatement statement = source.prepareStatement(SQL_COLUMNS))
        {
            statement.setString(1, schema);
            statement.setString(2, schema);
            statement.setString(3, table);
            statement.setString(4, table);
            try (ResultSet rs = statement.executeQuery())
            {
                while (rs.next())
                {
                    String resolvedSchema = rs.getString("schema_name");
                    String resolvedTable = rs.getString("object_name");
                    String columnName = rs.getString("column_name");
                    String typeName = rs.getString("type_name");
                    Integer size = toNullableInteger(rs.getObject("max_length"));
                    Integer precision = toNullableInteger(rs.getObject("numeric_precision"));
                    Integer scale = toNullableInteger(rs.getObject("numeric_scale"));
                    String nullable = Boolean.TRUE.equals(rs.getObject("is_nullable")) ? "YES"
                            : "NO";
                    String id = (catalog != null ? catalog + "."
                            : "")
                            + ((schema != null ? schema
                                    : resolvedSchema) != null
                                            ? (schema != null ? schema
                                                    : resolvedSchema)
                                              + "."
                                            : "")
                            + ((table != null ? table
                                    : resolvedTable) != null
                                            ? (table != null ? table
                                                    : resolvedTable)
                                              + "."
                                            : "")
                            + columnName;
                    columns.add(JdbcSchemaObjectFactory.column(id, new JdbcColumnDefinition(columnName, typeName, nullable, null, size, precision, scale)));
                }
            }
        }
        return columns;
    }

    private static Integer toNullableInteger(Object value)
    {
        if (value instanceof Number n)
        {
            return n.intValue();
        }
        return null;
    }

    private static Connection openForDatabase(String url, Properties baseProps, String database) throws SQLException
    {
        Properties props = new Properties();
        props.putAll(baseProps);
        props.setProperty("databaseName", database);
        return DriverManager.getConnection(url, props);
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
