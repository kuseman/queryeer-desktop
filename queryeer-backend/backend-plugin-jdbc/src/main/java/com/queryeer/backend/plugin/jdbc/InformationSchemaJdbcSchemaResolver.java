package com.queryeer.backend.plugin.jdbc;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.stream.Collectors;

import com.queryeer.backend.queryengine.jdbc.JdbcColumnDefinition;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaObjectFactory;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaResolver;

final class InformationSchemaJdbcSchemaResolver implements JdbcSchemaResolver
{
    private static final String KEY_URL = "url";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_PASSWORD = "password";
    private static final String KEY_USER = "user";
    private static final String OPTION_SCOPE = "scope";
    private static final String OPTION_TARGET = "target";
    private static final String SCOPE_TOP = "top";
    private static final String SCOPE_TABLES = "tables";
    private static final String SCOPE_COLUMNS = "columns";
    // private static final String KEY_DATABASE = "database";
    private static final String KEY_SCHEMA = "schema";
    // private static final String KEY_TABLE = "table";
    private static final String KEY_CATALOG = "catalog";
    private static final String KIND_SCHEMA = "schema";
    private static final String KIND_TABLE = "table";
    private static final String KIND_VIEW = "view";
    private static final String KIND_COLUMN = "column";
    private static final String KIND_DATABASE = "database";
    private static final String KIND_PRIMARY_KEY = "primary_key";
    private static final String KIND_FOREIGN_KEY = "foreign_key";
    private static final String KIND_INDEX = "index";
    private static final String DEFAULT_SCHEMA_NAME = "default";
    private static final String DEFAULT_CATALOG_NAME = "default";
    private static final String ERROR_RESOLVE_SCHEMA = "Failed to resolve JDBC schema";

    private static final String KEY_NULLABLE = "nullable";
    private static final String KEY_ORDINAL = "ordinal";
    private static final String KEY_COLUMN = "column";
    private static final String KEY_REFERENCES_TABLE = "referencesTable";
    private static final String KEY_REFERENCES_COLUMN = "referencesColumn";
    private static final String KEY_NON_UNIQUE = "nonUnique";

    @Override
    public List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection)
    {
        return resolveSchema(connection, Map.of());
    }

    @Override
    public List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection, Map<String, Object> options)
    {
        String url = text(connection.properties()
                .get(KEY_URL));
        if (url == null)
        {
            return List.of();
        }

        Properties properties = new Properties();
        String username = text(connection.properties()
                .get(KEY_USERNAME));
        String password = text(connection.properties()
                .get(KEY_PASSWORD));
        if (username != null)
        {
            properties.setProperty(KEY_USER, username);
        }
        if (password != null)
        {
            properties.setProperty(KEY_PASSWORD, password);
        }

        try (Connection jdbc = DriverManager.getConnection(url, properties))
        {
            String scope = text(options.get(OPTION_SCOPE));
            if (SCOPE_TOP.equalsIgnoreCase(scope))
            {
                return readTopLevelObjects(jdbc);
            }
            JdbcSchemaTarget target = targetFrom(options.get(OPTION_TARGET));
            if (SCOPE_TABLES.equalsIgnoreCase(scope))
            {
                return readTableNames(jdbc, target);
            }
            if (SCOPE_COLUMNS.equalsIgnoreCase(scope))
            {
                return readTableDetail(jdbc, target);
            }
            return readObjects(jdbc, target);
        }
        catch (SQLException e)
        {
            throw new RuntimeException(ERROR_RESOLVE_SCHEMA, e);
        }
    }

    private List<JdbcSchemaObject> readObjects(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        Map<String, List<TableRow>> bySchema = readTables(jdbc).stream()
                .collect(Collectors.groupingBy(row -> key(row.tableCatalog(), row.tableSchema()), LinkedHashMap::new, Collectors.toList()));
        Map<String, List<ColumnRow>> columnsByTable = readColumns(jdbc).stream()
                .collect(Collectors.groupingBy(row -> key(row.tableCatalog(), row.tableSchema(), row.tableName()), LinkedHashMap::new, Collectors.toList()));
        DatabaseMetaData metadata = jdbc.getMetaData();

        List<JdbcSchemaObject> result = new ArrayList<>();
        bySchema.forEach((schemaKey, tables) ->
        {
            tables.sort(Comparator.comparing(TableRow::tableName));
            List<JdbcSchemaObject> tableObjects = new ArrayList<>();
            for (TableRow table : tables)
            {
                if (target != null
                        && !target.matches(table.tableCatalog(), table.tableSchema()))
                {
                    continue;
                }
                List<ColumnRow> columns = columnsByTable.getOrDefault(key(table.tableCatalog(), table.tableSchema(), table.tableName()), List.of());
                List<JdbcSchemaObject> columnObjects = columns.stream()
                        .sorted(Comparator.comparingInt(ColumnRow::ordinalPosition))
                        .map(column -> JdbcSchemaObjectFactory.column("column:" + schemaKey + ":" + table.tableName() + ":" + column.columnName(),
                                new JdbcColumnDefinition(column.columnName(), column.dataType(), column.nullable(), column.ordinalPosition(), column.size(), column.precision(), column.scale())))
                        .toList();
                List<JdbcSchemaObject> children = new ArrayList<>(columnObjects);
                children.addAll(readPrimaryKeyObjects(metadata, table));
                children.addAll(readForeignKeyObjects(metadata, table));
                children.addAll(readIndexObjects(metadata, table));
                tableObjects.add(new JdbcSchemaObject("table:" + schemaKey + ":" + table.tableName(), table.tableName(), table.tableType()
                        .toLowerCase(), children, Map.of(KEY_CATALOG, nullToEmpty(table.tableCatalog()), KEY_SCHEMA, nullToEmpty(table.tableSchema()))));
            }
            String[] split = schemaKey.split("\\|", -1);
            String catalog = split.length > 0 ? split[0]
                    : "";
            String schema = split.length > 1 ? split[1]
                    : "";
            if (!tableObjects.isEmpty())
            {
                result.add(new JdbcSchemaObject("schema:" + schemaKey, schema.isBlank() ? DEFAULT_SCHEMA_NAME
                        : schema, KIND_SCHEMA, tableObjects, Map.of(KEY_CATALOG, catalog)));
            }
        });
        return toDatabaseHierarchy(result);
    }

    private List<JdbcSchemaObject> readTopLevelObjects(Connection jdbc) throws SQLException
    {
        List<JdbcSchemaObject> schemas = readTables(jdbc).stream()
                .map(table -> new JdbcSchemaObject("schema:" + key(table.tableCatalog(), table.tableSchema()), (table.tableSchema() == null
                        || table.tableSchema()
                                .isBlank()) ? DEFAULT_SCHEMA_NAME
                                        : table.tableSchema(),
                        KIND_SCHEMA, List.of(), Map.of(KEY_CATALOG, nullToEmpty(table.tableCatalog()))))
                .distinct()
                .toList();
        return toDatabaseHierarchy(schemas);
    }

    private static List<JdbcSchemaObject> toDatabaseHierarchy(List<JdbcSchemaObject> schemas)
    {
        Map<String, List<JdbcSchemaObject>> byCatalog = schemas.stream()
                .collect(Collectors.groupingBy(schema -> text(schema.attributes()
                        .get(KEY_CATALOG)) == null ? DEFAULT_CATALOG_NAME
                                : text(schema.attributes()
                                        .get(KEY_CATALOG)),
                        LinkedHashMap::new, Collectors.toList()));
        List<JdbcSchemaObject> databases = new ArrayList<>();
        byCatalog.forEach((catalog, children) -> databases.add(new JdbcSchemaObject("database:" + catalog, catalog, KIND_DATABASE, children, Map.of())));
        return databases;
    }

    private List<JdbcSchemaObject> readTableNames(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        String sql = """
                select table_catalog, table_schema, table_name, table_type
                from information_schema.tables
                where table_schema is not null
                and table_type in ('BASE TABLE', 'VIEW')
                order by table_catalog, table_schema, table_name
                """;
        List<JdbcSchemaObject> result = new ArrayList<>();
        try (PreparedStatement statement = jdbc.prepareStatement(sql); ResultSet resultSet = statement.executeQuery())
        {
            while (resultSet.next())
            {
                String tableCatalog = resultSet.getString(1);
                String tableSchema = resultSet.getString(2);
                String tableName = resultSet.getString(3);
                String tableType = resultSet.getString(4);
                if (target != null
                        && !target.matches(tableCatalog, tableSchema))
                {
                    continue;
                }
                String schemaKey = key(tableCatalog, tableSchema);
                String kind = "VIEW".equalsIgnoreCase(tableType) ? KIND_VIEW
                        : KIND_TABLE;
                result.add(
                        new JdbcSchemaObject("table:" + schemaKey + ":" + tableName, tableName, kind, List.of(), Map.of(KEY_CATALOG, nullToEmpty(tableCatalog), KEY_SCHEMA, nullToEmpty(tableSchema))));
            }
        }
        return result;
    }

    private List<JdbcSchemaObject> readTableDetail(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        if (target == null
                || target.table() == null
                || target.table()
                        .isBlank())
        {
            return List.of();
        }
        String tableName = target.table();
        String tableSchema = target.schema();
        String tableCatalog = target.database();
        String schemaKey = key(tableCatalog, tableSchema);
        DatabaseMetaData metadata = jdbc.getMetaData();

        List<JdbcSchemaObject> children = new ArrayList<>();

        // columns
        String sql = """
                select column_name, data_type, is_nullable, ordinal_position
                from information_schema.columns
                where table_name = ?
                and (table_schema = ? or ? is null)
                order by ordinal_position
                """;
        try (PreparedStatement statement = jdbc.prepareStatement(sql))
        {
            statement.setString(1, tableName);
            statement.setString(2, tableSchema == null ? ""
                    : tableSchema);
            statement.setString(3, tableSchema);
            try (ResultSet resultSet = statement.executeQuery())
            {
                while (resultSet.next())
                {
                    String colName = resultSet.getString(1);
                    String dataType = resultSet.getString(2);
                    String nullable = resultSet.getString(3);
                    int ordinal = resultSet.getInt(4);
                    children.add(JdbcSchemaObjectFactory.column("column:" + schemaKey + ":" + tableName + ":" + colName,
                            new JdbcColumnDefinition(colName, nullToEmpty(dataType), nullToEmpty(nullable), ordinal, null, null, null)));
                }
            }
        }

        TableRow tableRow = new TableRow(tableCatalog, tableSchema, tableName, "BASE TABLE");
        children.addAll(readPrimaryKeyObjects(metadata, tableRow));
        children.addAll(readForeignKeyObjects(metadata, tableRow));
        children.addAll(readIndexObjects(metadata, tableRow));

        return children;
    }

    private static JdbcSchemaTarget targetFrom(Object value)
    {
        if (value instanceof com.queryeer.backend.contract.jdbc.JdbcSchemaTarget t)
        {
            return new JdbcSchemaTarget(trimToNull(t.database()), trimToNull(t.schema()), trimToNull(t.table()));
        }
        if (value instanceof Map<?, ?> map)
        {
            String database = map.get("database") instanceof String s ? trimToNull(s)
                    : null;
            String schema = map.get("schema") instanceof String s ? trimToNull(s)
                    : null;
            String table = map.get("table") instanceof String s ? trimToNull(s)
                    : null;
            return new JdbcSchemaTarget(database, schema, table);
        }
        return null;
    }

    private List<JdbcSchemaObject> readPrimaryKeyObjects(DatabaseMetaData metadata, TableRow table)
    {
        try (ResultSet rs = metadata.getPrimaryKeys(nullToEmpty(table.tableCatalog()), nullToEmpty(table.tableSchema()), table.tableName()))
        {
            List<JdbcSchemaObject> result = new ArrayList<>();
            while (rs.next())
            {
                String columnName = rs.getString("COLUMN_NAME");
                if (columnName == null)
                {
                    continue;
                }
                String pkName = rs.getString("PK_NAME");
                result.add(new JdbcSchemaObject("pk:" + table.tableSchema() + ":" + table.tableName() + ":" + columnName, pkName == null ? "PRIMARY_KEY"
                        : pkName, KIND_PRIMARY_KEY, List.of(), Map.of(KEY_COLUMN, columnName, KEY_ORDINAL, rs.getShort("KEY_SEQ"))));
            }
            return result;
        }
        catch (SQLException e)
        {
            return List.of();
        }
    }

    private List<JdbcSchemaObject> readForeignKeyObjects(DatabaseMetaData metadata, TableRow table)
    {
        try (ResultSet rs = metadata.getImportedKeys(nullToEmpty(table.tableCatalog()), nullToEmpty(table.tableSchema()), table.tableName()))
        {
            List<JdbcSchemaObject> result = new ArrayList<>();
            while (rs.next())
            {
                String fkColumn = rs.getString("FKCOLUMN_NAME");
                if (fkColumn == null)
                {
                    continue;
                }
                String fkName = rs.getString("FK_NAME");
                String pkTable = rs.getString("PKTABLE_NAME");
                String pkColumn = rs.getString("PKCOLUMN_NAME");
                result.add(new JdbcSchemaObject("fk:" + table.tableSchema() + ":" + table.tableName() + ":" + fkColumn, fkName == null ? "FOREIGN_KEY"
                        : fkName, KIND_FOREIGN_KEY, List.of(), Map.of(KEY_COLUMN, fkColumn, KEY_REFERENCES_TABLE, nullToEmpty(pkTable), KEY_REFERENCES_COLUMN, nullToEmpty(pkColumn))));
            }
            return result;
        }
        catch (SQLException e)
        {
            return List.of();
        }
    }

    private List<JdbcSchemaObject> readIndexObjects(DatabaseMetaData metadata, TableRow table)
    {
        try (ResultSet rs = metadata.getIndexInfo(nullToEmpty(table.tableCatalog()), nullToEmpty(table.tableSchema()), table.tableName(), false, false))
        {
            List<JdbcSchemaObject> result = new ArrayList<>();
            while (rs.next())
            {
                String indexName = rs.getString("INDEX_NAME");
                String columnName = rs.getString("COLUMN_NAME");
                if (indexName == null
                        || columnName == null)
                {
                    continue;
                }
                result.add(new JdbcSchemaObject("idx:" + table.tableSchema() + ":" + table.tableName() + ":" + indexName + ":" + columnName, indexName, KIND_INDEX, List.of(),
                        Map.of(KEY_COLUMN, columnName, KEY_ORDINAL, rs.getShort("ORDINAL_POSITION"), KEY_NON_UNIQUE, rs.getBoolean("NON_UNIQUE"))));
            }
            return result;
        }
        catch (SQLException e)
        {
            return List.of();
        }
    }

    private List<TableRow> readTables(Connection jdbc) throws SQLException
    {
        String sql = """
                select table_catalog, table_schema, table_name, table_type
                from information_schema.tables
                where table_schema is not null
                and table_type in ('BASE TABLE', 'VIEW')
                order by table_catalog, table_schema, table_name
                """;
        try (PreparedStatement statement = jdbc.prepareStatement(sql); ResultSet resultSet = statement.executeQuery())
        {
            List<TableRow> rows = new ArrayList<>();
            while (resultSet.next())
            {
                rows.add(new TableRow(resultSet.getString(1), resultSet.getString(2), resultSet.getString(3), resultSet.getString(4)));
            }
            return rows;
        }
    }

    private List<ColumnRow> readColumns(Connection jdbc) throws SQLException
    {
        String sql = """
                select table_catalog, table_schema, table_name, column_name, data_type, is_nullable, ordinal_position, character_maximum_length, numeric_precision, numeric_scale
                from information_schema.columns
                where table_schema is not null
                order by table_catalog, table_schema, table_name, ordinal_position
                """;
        try (PreparedStatement statement = jdbc.prepareStatement(sql); ResultSet resultSet = statement.executeQuery())
        {
            List<ColumnRow> rows = new ArrayList<>();
            while (resultSet.next())
            {
                rows.add(new ColumnRow(resultSet.getString(1), resultSet.getString(2), resultSet.getString(3), resultSet.getString(4), resultSet.getString(5), resultSet.getString(6),
                        resultSet.getInt(7), toNullableInteger(resultSet.getObject(8)), toNullableInteger(resultSet.getObject(9)), toNullableInteger(resultSet.getObject(10))));
            }
            return rows;
        }
    }

    private static Integer toNullableInteger(Object value)
    {
        if (value instanceof Number n)
        {
            return n.intValue();
        }
        return null;
    }

    private static String key(String... values)
    {
        return java.util.Arrays.stream(values)
                .map(InformationSchemaJdbcSchemaResolver::nullToEmpty)
                .collect(Collectors.joining("|"));
    }

    private static String text(Object value)
    {
        if (!(value instanceof String stringValue))
        {
            return null;
        }
        String trimmed = stringValue.trim();
        return trimmed.isBlank() ? null
                : trimmed;
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

    private static String nullToEmpty(String value)
    {
        return value == null ? ""
                : value;
    }

    private record TableRow(String tableCatalog, String tableSchema, String tableName, String tableType)
    {
    }

    private record ColumnRow(String tableCatalog, String tableSchema, String tableName, String columnName, String dataType, String nullable, int ordinalPosition, Integer size, Integer precision,
            Integer scale)
    {
    }
}
