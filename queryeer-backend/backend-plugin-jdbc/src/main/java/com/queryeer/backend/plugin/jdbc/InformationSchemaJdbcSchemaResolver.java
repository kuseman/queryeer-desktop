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

import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaResolver;

final class InformationSchemaJdbcSchemaResolver implements JdbcSchemaResolver
{
    @Override
    public List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection)
    {
        return resolveSchema(connection, Map.of());
    }

    @Override
    public List<JdbcSchemaObject> resolveSchema(JdbcConnectionProfile connection, Map<String, Object> options)
    {
        String url = text(connection.properties()
                .get("url"));
        if (url == null)
        {
            return List.of();
        }

        Properties properties = new Properties();
        String username = text(connection.properties()
                .get("username"));
        String password = text(connection.properties()
                .get("password"));
        if (username != null)
        {
            properties.setProperty("user", username);
        }
        if (password != null)
        {
            properties.setProperty("password", password);
        }

        try (Connection jdbc = DriverManager.getConnection(url, properties))
        {
            String scope = text(options.get("scope"));
            if ("top".equalsIgnoreCase(scope))
            {
                return readTopLevelObjects(jdbc);
            }
            JdbcSchemaTarget target = targetFrom(options.get("target"));
            if ("tables".equalsIgnoreCase(scope))
            {
                return readTableNames(jdbc, target);
            }
            if ("columns".equalsIgnoreCase(scope))
            {
                return readTableDetail(jdbc, target);
            }
            return readObjects(jdbc, target);
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to resolve JDBC schema", e);
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
                        .map(column -> new JdbcSchemaObject("column:" + schemaKey + ":" + table.tableName() + ":" + column.columnName(), column.columnName(), "column", List.of(),
                                Map.of("type", column.dataType(), "nullable", column.nullable(), "ordinal", column.ordinalPosition())))
                        .toList();
                List<JdbcSchemaObject> children = new ArrayList<>(columnObjects);
                children.addAll(readPrimaryKeyObjects(metadata, table));
                children.addAll(readForeignKeyObjects(metadata, table));
                children.addAll(readIndexObjects(metadata, table));
                tableObjects.add(new JdbcSchemaObject("table:" + schemaKey + ":" + table.tableName(), table.tableName(), table.tableType()
                        .toLowerCase(), children, Map.of("catalog", nullToEmpty(table.tableCatalog()), "schema", nullToEmpty(table.tableSchema()))));
            }
            String[] split = schemaKey.split("\\|", -1);
            String catalog = split.length > 0 ? split[0]
                    : "";
            String schema = split.length > 1 ? split[1]
                    : "";
            if (!tableObjects.isEmpty())
            {
                result.add(new JdbcSchemaObject("schema:" + schemaKey, schema.isBlank() ? "default"
                        : schema, "schema", tableObjects, Map.of("catalog", catalog)));
            }
        });
        return toDatabaseHierarchy(result);
    }

    private List<JdbcSchemaObject> readTopLevelObjects(Connection jdbc) throws SQLException
    {
        List<JdbcSchemaObject> schemas = readTables(jdbc).stream()
                .map(table -> new JdbcSchemaObject("schema:" + key(table.tableCatalog(), table.tableSchema()), (table.tableSchema() == null
                        || table.tableSchema()
                                .isBlank()) ? "default"
                                        : table.tableSchema(),
                        "schema", List.of(), Map.of("catalog", nullToEmpty(table.tableCatalog()))))
                .distinct()
                .toList();
        return toDatabaseHierarchy(schemas);
    }

    private static List<JdbcSchemaObject> toDatabaseHierarchy(List<JdbcSchemaObject> schemas)
    {
        Map<String, List<JdbcSchemaObject>> byCatalog = schemas.stream()
                .collect(Collectors.groupingBy(schema -> text(schema.attributes()
                        .get("catalog")) == null ? "default"
                                : text(schema.attributes()
                                        .get("catalog")),
                        LinkedHashMap::new, Collectors.toList()));
        List<JdbcSchemaObject> databases = new ArrayList<>();
        byCatalog.forEach((catalog, children) -> databases.add(new JdbcSchemaObject("database:" + catalog, catalog, "database", children, Map.of())));
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
                String kind = "VIEW".equalsIgnoreCase(tableType) ? "view"
                        : "table";
                result.add(new JdbcSchemaObject("table:" + schemaKey + ":" + tableName, tableName, kind, List.of(), Map.of("catalog", nullToEmpty(tableCatalog), "schema", nullToEmpty(tableSchema))));
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
                    children.add(new JdbcSchemaObject("column:" + schemaKey + ":" + tableName + ":" + colName, colName, "column", List.of(),
                            Map.of("type", nullToEmpty(dataType), "nullable", nullToEmpty(nullable), "ordinal", ordinal)));
                }
            }
        }

        TableRow tableRow = new TableRow(tableCatalog, tableSchema, tableName, "BASE TABLE");
        children.addAll(readPrimaryKeyObjects(metadata, tableRow));
        children.addAll(readForeignKeyObjects(metadata, tableRow));
        children.addAll(readIndexObjects(metadata, tableRow));

        return children;
    }

    @SuppressWarnings("unchecked")
    private static JdbcSchemaTarget targetFrom(Object value)
    {
        if (!(value instanceof Map<?, ?> map))
        {
            return null;
        }
        Map<String, Object> m = (Map<String, Object>) map;
        return new JdbcSchemaTarget(text(m.get("database")), text(m.get("schema")), text(m.get("table")));
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
                        : pkName, "primary_key", List.of(), Map.of("column", columnName, "ordinal", rs.getShort("KEY_SEQ"))));
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
                        : fkName, "foreign_key", List.of(), Map.of("column", fkColumn, "referencesTable", nullToEmpty(pkTable), "referencesColumn", nullToEmpty(pkColumn))));
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
                result.add(new JdbcSchemaObject("idx:" + table.tableSchema() + ":" + table.tableName() + ":" + indexName + ":" + columnName, indexName, "index", List.of(),
                        Map.of("column", columnName, "ordinal", rs.getShort("ORDINAL_POSITION"), "nonUnique", rs.getBoolean("NON_UNIQUE"))));
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
                select table_catalog, table_schema, table_name, column_name, data_type, is_nullable, ordinal_position
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
                        resultSet.getInt(7)));
            }
            return rows;
        }
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

    private static String nullToEmpty(String value)
    {
        return value == null ? ""
                : value;
    }

    private record TableRow(String tableCatalog, String tableSchema, String tableName, String tableType)
    {
    }

    private record ColumnRow(String tableCatalog, String tableSchema, String tableName, String columnName, String dataType, String nullable, int ordinalPosition)
    {
    }
}
