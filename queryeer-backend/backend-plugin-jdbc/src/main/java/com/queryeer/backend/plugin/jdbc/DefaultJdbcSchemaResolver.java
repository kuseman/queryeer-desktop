package com.queryeer.backend.plugin.jdbc;

import static com.queryeer.backend.api.PayloadUtils.nullToEmpty;
import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import com.queryeer.backend.api.PayloadUtils;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

public class DefaultJdbcSchemaResolver implements JdbcSchemaResolver
{
    private static final String OPTION_PARENT_KIND = "parentKind";
    private static final String OPTION_SCOPE = "scope";
    private static final String OPTION_TARGET = "target";
    private static final String SCOPE_TOP = "top";
    private static final String SCOPE_TABLES = "tables";
    private static final String SCOPE_COLUMNS = "columns";
    private static final String KEY_SCHEMA = "schema";
    private static final String KEY_TABLE = "table";
    private static final String KEY_CATALOG = "catalog";
    private static final String KIND_SCHEMA = "schema";
    private static final String KIND_TABLE = "table";
    private static final String KIND_VIEW = "view";
    private static final String KIND_DATABASE = "database";
    private static final String KIND_DATABASES_CONTAINER = "databases_container";
    private static final String KIND_SCHEMAS_CONTAINER = "schemas_container";
    private static final String KIND_TABLES_FOLDER = "tables_folder";
    private static final String KIND_VIEWS_FOLDER = "views_folder";
    private static final String KIND_PROCEDURES_FOLDER = "procedures_folder";
    private static final String KIND_TRIGGERS_FOLDER = "triggers_folder";
    private static final String KIND_COLUMNS_FOLDER = "columns_folder";
    private static final String KIND_INDEXES_FOLDER = "indexes_folder";
    private static final String KEY_TYPE = "type";
    private static final String DEFAULT_SCHEMA_NAME = "default";
    private static final String DEFAULT_CATALOG_NAME = "default";
    private static final String ERROR_RESOLVE_SCHEMA = "Failed to resolve JDBC schema";

    @Override
    public List<JdbcSchemaObject> resolveSchema(JdbcConnection connection, Map<String, Object> options)
    {
        try (Connection jdbc = connection.dialect()
                .openSessionConnection(connection.properties()))
        {
            String parentKind = stringValue(options, OPTION_PARENT_KIND);
            if (parentKind == null)
            {
                String scope = stringValue(options, OPTION_SCOPE);
                parentKind = switch (scope)
                {
                    case SCOPE_TOP -> KIND_DATABASES_CONTAINER;
                    case SCOPE_TABLES -> KIND_TABLES_FOLDER;
                    case SCOPE_COLUMNS -> KIND_TABLE;
                    case null -> KIND_DATABASES_CONTAINER;
                    default -> KIND_DATABASES_CONTAINER;
                };
            }

            JdbcSchemaTarget target = targetFrom(options.get(OPTION_TARGET));
            return resolveChildren(jdbc, parentKind, target);
        }
        catch (SQLException e)
        {
            throw new RuntimeException(ERROR_RESOLVE_SCHEMA, e);
        }
    }

    private List<JdbcSchemaObject> resolveChildren(Connection jdbc, String parentKind, JdbcSchemaTarget target) throws SQLException
    {
        return switch (parentKind)
        {
            case "connection", KIND_DATABASES_CONTAINER -> readDatabasesContainer(jdbc);
            case KIND_DATABASE -> readDatabaseChildren(jdbc, target);
            case KIND_SCHEMAS_CONTAINER -> readSchemas(jdbc, target);
            case KIND_SCHEMA -> createSchemaFolders(target);
            case KIND_TABLES_FOLDER -> readTables(jdbc, target);
            case KIND_VIEWS_FOLDER -> readViews(jdbc, target);
            case KIND_PROCEDURES_FOLDER -> readProcedures(jdbc, target);
            case KIND_TRIGGERS_FOLDER -> readTriggers(jdbc, target);
            case KIND_COLUMNS_FOLDER -> readColumns(jdbc, target);
            case KIND_INDEXES_FOLDER -> readIndexes(jdbc, target);
            case KIND_TABLE, KIND_VIEW -> readTableFolders(jdbc, target);
            default -> List.of();
        };
    }

    private List<JdbcSchemaObject> readDatabasesContainer(Connection jdbc) throws SQLException
    {
        // Return databases with lazy children — schema_container is resolved via parentKind=database
        List<JdbcSchemaObject> databases = readSchemaNodes(jdbc).stream()
                .collect(Collectors.groupingBy(s ->
                {
                    String cat = stringValue(s.attributes(), KEY_CATALOG);
                    return cat == null
                            || cat.isBlank() ? DEFAULT_CATALOG_NAME
                                    : cat;
                }, LinkedHashMap::new, Collectors.toList()))
                .entrySet()
                .stream()
                .map(e -> new JdbcSchemaObject("database:" + e.getKey(), e.getKey(), KIND_DATABASE, null, Map.of()))
                .toList();
        return List.of(new JdbcSchemaObject("__databases__", "Databases", KIND_DATABASES_CONTAINER, databases, Map.of()));
    }

    private List<JdbcSchemaObject> readDatabaseChildren(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        String database = target != null ? trimToNull(target.database())
                : null;
        List<JdbcSchemaObject> schemas = readSchemaNodes(jdbc).stream()
                .filter(s ->
                {
                    String cat = stringValue(s.attributes(), KEY_CATALOG);
                    return database == null
                            || database.equalsIgnoreCase(cat);
                })
                .toList();
        if (schemas.isEmpty())
        {
            return List.of();
        }
        return List.of(new JdbcSchemaObject("__schemas__" + (database != null ? ":" + database
                : ""), "Schemas", KIND_SCHEMAS_CONTAINER, schemas, Map.of()));
    }

    private List<JdbcSchemaObject> readSchemas(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        String database = target != null ? trimToNull(target.database())
                : null;
        return readSchemaNodes(jdbc).stream()
                .filter(s ->
                {
                    String cat = stringValue(s.attributes(), KEY_CATALOG);
                    return database == null
                            || database.equalsIgnoreCase(cat);
                })
                .toList();
    }

    private List<JdbcSchemaObject> createSchemaFolders(JdbcSchemaTarget target)
    {
        Map<String, Object> attrs = new LinkedHashMap<>();
        String db = null;
        String schema = null;
        if (target != null)
        {
            if (target.database() != null)
            {
                db = target.database();
                attrs.put(KEY_CATALOG, db);
            }
            if (target.schema() != null)
            {
                schema = target.schema();
                attrs.put(KEY_SCHEMA, schema);
            }
        }
        // Include schema context in IDs so each schema's folders are unique
        String schemaSuffix = (db != null ? db
                : "") + "."
                              + (schema != null ? schema
                                      : "");
        return List.of(new JdbcSchemaObject("tables_folder:" + schemaSuffix, "Tables", KIND_TABLES_FOLDER, null, attrs),
                new JdbcSchemaObject("views_folder:" + schemaSuffix, "Views", KIND_VIEWS_FOLDER, null, attrs),
                new JdbcSchemaObject("procedures_folder:" + schemaSuffix, "Procedures", KIND_PROCEDURES_FOLDER, null, attrs),
                new JdbcSchemaObject("triggers_folder:" + schemaSuffix, "Triggers", KIND_TRIGGERS_FOLDER, null, attrs));
    }

    private List<JdbcSchemaObject> readTables(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        List<JdbcSchemaObject> result = new ArrayList<>();
        String sql = """
                select table_catalog, table_schema, table_name
                from information_schema.tables
                where table_type = 'BASE TABLE'
                order by table_catalog, table_schema, table_name
                """;
        try (PreparedStatement statement = jdbc.prepareStatement(sql); ResultSet rs = statement.executeQuery())
        {
            while (rs.next())
            {
                String catalog = rs.getString(1);
                String schema = rs.getString(2);
                String name = rs.getString(3);
                if (target != null
                        && !targetMatches(target, catalog, schema))
                {
                    continue;
                }
                String fullName = buildFullName(schema, name);
                result.add(new JdbcSchemaObject("table:" + key(catalog, schema) + ":" + name, name, KIND_TABLE, null, fullName, null,
                        Map.of(KEY_CATALOG, nullToEmpty(catalog), KEY_SCHEMA, nullToEmpty(schema))));
            }
        }
        return result;
    }

    /**
     * Checks whether a row with the given catalog and schema matches the target filter. Unlike {@link JdbcSchemaTarget#matches(String, String)}, this handles the case where the target has a database
     * but no schema by filtering on database only.
     */
    static boolean targetMatches(JdbcSchemaTarget target, String candidateCatalog, String candidateSchema)
    {
        if (target.schema() != null
                && !target.schema()
                        .isBlank())
        {
            return target.matches(candidateCatalog, candidateSchema);
        }
        if (target.database() != null
                && !target.database()
                        .isBlank())
        {
            return target.database()
                    .equalsIgnoreCase(candidateCatalog == null ? ""
                            : candidateCatalog);
        }
        return true;
    }

    private List<JdbcSchemaObject> readViews(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        List<JdbcSchemaObject> result = new ArrayList<>();
        String sql = """
                select table_catalog, table_schema, table_name
                from information_schema.tables
                where table_type = 'VIEW'
                order by table_catalog, table_schema, table_name
                """;
        try (PreparedStatement statement = jdbc.prepareStatement(sql); ResultSet rs = statement.executeQuery())
        {
            while (rs.next())
            {
                String catalog = rs.getString(1);
                String schema = rs.getString(2);
                String name = rs.getString(3);
                if (target != null
                        && !targetMatches(target, catalog, schema))
                {
                    continue;
                }
                String fullName = buildFullName(schema, name);
                result.add(new JdbcSchemaObject("view:" + key(catalog, schema) + ":" + name, name, KIND_VIEW, null, fullName, null,
                        Map.of(KEY_CATALOG, nullToEmpty(catalog), KEY_SCHEMA, nullToEmpty(schema))));
            }
        }
        return result;
    }

    private List<JdbcSchemaObject> readProcedures(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        List<JdbcSchemaObject> result = new ArrayList<>();
        String sql = """
                select specific_catalog, specific_schema, specific_name, routine_name
                from information_schema.routines
                where routine_type = 'PROCEDURE'
                order by specific_catalog, specific_schema, specific_name
                """;
        try (PreparedStatement statement = jdbc.prepareStatement(sql); ResultSet rs = statement.executeQuery())
        {
            while (rs.next())
            {
                String catalog = rs.getString(1);
                String schema = rs.getString(2);
                String specificName = rs.getString(3);
                String routineName = rs.getString(4);
                if (target != null
                        && !targetMatches(target, catalog, schema))
                {
                    continue;
                }
                String fullName = buildFullName(schema, routineName);
                result.add(new JdbcSchemaObject("procedure:" + key(catalog, schema) + ":" + specificName, routineName, "procedure", null, fullName, null,
                        Map.of(KEY_CATALOG, nullToEmpty(catalog), KEY_SCHEMA, nullToEmpty(schema))));
            }
        }
        return result;
    }

    private List<JdbcSchemaObject> readTriggers(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        List<JdbcSchemaObject> result = new ArrayList<>();
        String sql = """
                select event_object_catalog, event_object_schema, trigger_name, trigger_name
                from information_schema.triggers
                order by event_object_catalog, event_object_schema, trigger_name
                """;
        try (PreparedStatement statement = jdbc.prepareStatement(sql); ResultSet rs = statement.executeQuery())
        {
            while (rs.next())
            {
                String catalog = rs.getString(1);
                String schema = rs.getString(2);
                String triggerName = rs.getString(3);
                if (target != null
                        && !targetMatches(target, catalog, schema))
                {
                    continue;
                }
                String fullName = buildFullName(schema, triggerName);
                result.add(new JdbcSchemaObject("trigger:" + key(catalog, schema) + ":" + triggerName, triggerName, "trigger", null, fullName, null,
                        Map.of(KEY_CATALOG, nullToEmpty(catalog), KEY_SCHEMA, nullToEmpty(schema))));
            }
        }
        return result;
    }

    private List<JdbcSchemaObject> readTableFolders(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        if (target == null
                || target.table() == null
                || PayloadUtils.isBlank(target.table()))
        {
            return List.of();
        }
        String tableCatalog = target.database();
        String tableSchema = target.schema();
        Map<String, Object> folderAttrs = new LinkedHashMap<>();
        folderAttrs.put(KEY_CATALOG, nullToEmpty(tableCatalog));
        folderAttrs.put(KEY_SCHEMA, nullToEmpty(tableSchema));
        folderAttrs.put(KEY_TABLE, target.table());
        String schemaKey = key(tableCatalog, tableSchema);
        return List.of(new JdbcSchemaObject(KIND_COLUMNS_FOLDER + ":" + schemaKey + ":" + target.table(), "Columns", KIND_COLUMNS_FOLDER, null, folderAttrs),
                new JdbcSchemaObject(KIND_INDEXES_FOLDER + ":" + schemaKey + ":" + target.table(), "Indexes", KIND_INDEXES_FOLDER, null, folderAttrs));
    }

    private List<JdbcSchemaObject> readColumns(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        if (target == null
                || target.table() == null
                || PayloadUtils.isBlank(target.table()))
        {
            return List.of();
        }
        String tableName = target.table();
        String tableSchema = target.schema();
        String tableCatalog = target.database();
        String schemaKey = key(tableCatalog, tableSchema);
        DatabaseMetaData metadata = jdbc.getMetaData();

        Set<String> pkColumns = new HashSet<>();
        try (ResultSet rs = metadata.getPrimaryKeys(nullToEmpty(tableCatalog), nullToEmpty(tableSchema), tableName))
        {
            while (rs.next())
            {
                String col = rs.getString("COLUMN_NAME");
                if (col != null)
                {
                    pkColumns.add(col);
                }
            }
        }
        catch (SQLException ignored)
        {
        }
        Map<String, List<String>> fkMap = new HashMap<>();
        try (ResultSet rs = metadata.getImportedKeys(nullToEmpty(tableCatalog), nullToEmpty(tableSchema), tableName))
        {
            while (rs.next())
            {
                String col = rs.getString("FKCOLUMN_NAME");
                String refTable = rs.getString("PKTABLE_NAME");
                String refColumn = rs.getString("PKCOLUMN_NAME");
                if (col != null)
                {
                    fkMap.put(col, List.of(nullToEmpty(refTable), nullToEmpty(refColumn)));
                }
            }
        }
        catch (SQLException ignored)
        {
        }

        String sql = """
                select column_name, data_type, is_nullable, ordinal_position
                from information_schema.columns
                where table_name = ?
                and (table_schema = ? or ? is null)
                order by ordinal_position
                """;
        List<JdbcSchemaObject> children = new ArrayList<>();
        try (PreparedStatement statement = jdbc.prepareStatement(sql))
        {
            statement.setString(1, tableName);
            statement.setString(2, tableSchema == null ? ""
                    : tableSchema);
            statement.setString(3, tableSchema);
            try (ResultSet rs = statement.executeQuery())
            {
                while (rs.next())
                {
                    String dataType = rs.getString(2);
                    String nullable = rs.getString(3);
                    int ordinal = rs.getInt(4);
                    Map<String, Object> attrs = new LinkedHashMap<>();
                    attrs.put(KEY_TYPE, nullToEmpty(dataType).toLowerCase());
                    if (nullable != null)
                    {
                        attrs.put("nullable", nullable);
                    }
                    attrs.put("ordinal", ordinal);
                    String colName = rs.getString(1);
                    if (pkColumns.contains(colName))
                    {
                        attrs.put("primaryKey", true);
                    }
                    List<String> fkInfo = fkMap.get(colName);
                    if (fkInfo != null)
                    {
                        attrs.put("foreignKey", true);
                        attrs.put("referencesTable", fkInfo.get(0));
                        attrs.put("referencesColumn", fkInfo.get(1));
                    }
                    children.add(new JdbcSchemaObject("column:" + schemaKey + ":" + tableName + ":" + colName, colName, "column", null, Map.copyOf(attrs)));
                }
            }
        }

        return children;
    }

    private List<JdbcSchemaObject> readIndexes(Connection jdbc, JdbcSchemaTarget target) throws SQLException
    {
        if (target == null
                || target.table() == null
                || PayloadUtils.isBlank(target.table()))
        {
            return List.of();
        }
        String tableName = target.table();
        String tableSchema = target.schema();
        String tableCatalog = target.database();
        String schemaKey = key(tableCatalog, tableSchema);
        DatabaseMetaData metadata = jdbc.getMetaData();

        List<JdbcSchemaObject> indexes = new ArrayList<>();
        Map<String, List<Map<String, Object>>> indexColumns = new LinkedHashMap<>();
        try (ResultSet rs = metadata.getIndexInfo(nullToEmpty(tableCatalog), nullToEmpty(tableSchema), tableName, false, false))
        {
            while (rs.next())
            {
                String indexName = rs.getString("INDEX_NAME");
                if (indexName == null
                        || indexName.isBlank())
                {
                    continue;
                }
                String colName = rs.getString("COLUMN_NAME");
                Boolean nonUnique = rs.getBoolean("NON_UNIQUE");
                if (rs.wasNull())
                {
                    nonUnique = null;
                }
                short ordinal = rs.getShort("ORDINAL_POSITION");
                String ascOrDesc = rs.getString("ASC_OR_DESC");
                if (colName != null)
                {
                    Map<String, Object> colEntry = new LinkedHashMap<>();
                    colEntry.put("column", colName);
                    colEntry.put("ordinal", ordinal);
                    if (ascOrDesc != null)
                    {
                        colEntry.put("sortOrder", "A".equalsIgnoreCase(ascOrDesc) ? "ASC"
                                : "D".equalsIgnoreCase(ascOrDesc) ? "DESC"
                                        : ascOrDesc);
                    }
                    indexColumns.computeIfAbsent(indexName, _ -> new ArrayList<>())
                            .add(colEntry);
                }
                if (nonUnique != null
                        && !indexColumns.containsKey(indexName))
                {
                    indexColumns.computeIfAbsent(indexName, _ -> new ArrayList<>())
                            .add(Map.of("unique", !nonUnique));
                }
            }
        }
        catch (SQLException ignored)
        {
        }

        for (Map.Entry<String, List<Map<String, Object>>> entry : indexColumns.entrySet())
        {
            String indexName = entry.getKey();
            List<Map<String, Object>> colInfos = entry.getValue();
            Map<String, Object> attrs = new LinkedHashMap<>();
            List<String> columnNames = new ArrayList<>();
            List<JdbcSchemaObject> indexColumnChildren = new ArrayList<>();
            for (Map<String, Object> colInfo : colInfos)
            {
                if (colInfo.containsKey("column"))
                {
                    String colName = (String) colInfo.get("column");
                    columnNames.add(colName);
                    Short ord = (Short) colInfo.get("ordinal");
                    String sortOrder = (String) colInfo.get("sortOrder");
                    Map<String, Object> colAttrs = new LinkedHashMap<>();
                    colAttrs.put("ordinal", ord != null ? ord
                            : 0);
                    if (sortOrder != null)
                    {
                        colAttrs.put("sortOrder", sortOrder);
                    }
                    indexColumnChildren.add(new JdbcSchemaObject("index_col:" + schemaKey + ":" + tableName + ":" + indexName + ":" + colName, colName, "index_column", null, Map.copyOf(colAttrs)));
                }
                if (colInfo.containsKey("unique"))
                {
                    attrs.put("unique", colInfo.get("unique"));
                }
            }
            if (!columnNames.isEmpty())
            {
                attrs.put("columns", String.join(", ", columnNames));
            }
            indexes.add(new JdbcSchemaObject("index:" + schemaKey + ":" + tableName + ":" + indexName, indexName, "index", indexColumnChildren.isEmpty() ? null
                    : List.copyOf(indexColumnChildren), Map.copyOf(attrs)));
        }

        return indexes;
    }

    private static List<JdbcSchemaObject> readSchemaNodes(Connection jdbc) throws SQLException
    {
        String sql = """
                select table_catalog, table_schema
                from information_schema.tables
                where table_schema is not null
                and table_type in ('BASE TABLE', 'VIEW')
                group by table_catalog, table_schema
                order by table_catalog, table_schema
                """;
        try (PreparedStatement statement = jdbc.prepareStatement(sql); ResultSet rs = statement.executeQuery())
        {
            List<JdbcSchemaObject> schemas = new ArrayList<>();
            while (rs.next())
            {
                String catalog = rs.getString(1);
                String schema = rs.getString(2);
                String schemaName = (schema == null
                        || schema.isBlank()) ? DEFAULT_SCHEMA_NAME
                                : schema;
                schemas.add(new JdbcSchemaObject("schema:" + key(catalog, schema), schemaName, KIND_SCHEMA, List.of(), Map.of(KEY_CATALOG, nullToEmpty(catalog))));
            }
            return schemas;
        }
    }

    private static String buildFullName(String schema, String name)
    {
        if (schema != null
                && !schema.isBlank())
        {
            return schema + "." + name;
        }
        return name;
    }

    private static JdbcSchemaTarget targetFrom(Object value)
    {
        if (value instanceof JdbcSchemaTarget t)
        {
            return new JdbcSchemaTarget(trimToNull(t.database()), trimToNull(t.schema()), trimToNull(t.table()));
        }
        if (value instanceof Map<?, ?> map)
        {
            String database = trimToNull(stringValue(map, "database"));
            String schema = trimToNull(stringValue(map, "schema"));
            String table = trimToNull(stringValue(map, "table"));
            return new JdbcSchemaTarget(database, schema, table);
        }
        return null;
    }

    private static String key(String... values)
    {
        return Arrays.stream(values)
                .map(PayloadUtils::nullToEmpty)
                .collect(Collectors.joining("|"));
    }
}
