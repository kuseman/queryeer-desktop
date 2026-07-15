package com.queryeer.backend.plugin.jdbc.sqlite;

import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectSupport;
import com.queryeer.backend.queryengine.jdbc.execute.AbstractJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

final class SqliteDialect implements JdbcDialect
{
    static final String DIALECT_ID = "sqlite";

    private static final String KEY_TYPE = "type";
    private static final String KIND_TABLE = "table";
    private static final String KIND_VIEW = "view";
    private static final String KIND_TABLES_FOLDER = "tables_folder";
    private static final String KIND_VIEWS_FOLDER = "views_folder";
    private static final String KIND_COLUMNS_FOLDER = "columns_folder";
    private static final String KIND_INDEXES_FOLDER = "indexes_folder";
    private static final String OPTION_TARGET = "target";
    private static final String ERROR_LIST_OBJECTS = "Failed to list SQLite objects";

    private static final JdbcDialectMetadata METADATA = new JdbcDialectMetadata(DIALECT_ID, "SQLite", null, "jdbc:sqlite:{file}", "org.sqlite.JDBC");

    //@formatter:off
    private static final String SQL_MASTER_TABLES = """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
              AND name NOT LIKE 'sqlite_%%'
            ORDER BY name
            """;

    private static final String SQL_MASTER_VIEWS = """
            SELECT name
            FROM sqlite_master
            WHERE type = 'view'
            ORDER BY name
            """;
    //@formatter:on

    private final JdbcQueryExecutor queryExecutor = new AbstractJdbcQueryExecutor()
    {
    };

    @Override
    public JdbcDialectMetadata metadata()
    {
        return METADATA;
    }

    @Override
    public JdbcQueryExecutor queryExecutor()
    {
        return queryExecutor;
    }

    @Override
    public boolean canSwitchDatabase()
    {
        return false;
    }

    @Override
    public void applyDatabase(Connection connection, String database)
    {
    }

    @Override
    public String resolveCurrentDatabase(Connection connection)
    {
        return null;
    }

    @Override
    public String buildUrl(Map<String, Object> materializedProperties)
    {
        String filePath = stringValue(materializedProperties, "filePath");
        if (filePath == null)
        {
            return null;
        }
        return "jdbc:sqlite:" + filePath;
    }

    private static final String KIND_DATABASES_CONTAINER = "databases_container";
    private static final String KIND_DATABASE = "database";
    private static final String KIND_SCHEMAS_CONTAINER = "schemas_container";

    @Override
    public Map<String, JdbcSchemaResolver> branchResolvers()
    {
        //@formatter:off
        return Map.ofEntries(
                Map.entry("connection", this::resolveConnectionRoot),
                Map.entry(KIND_DATABASES_CONTAINER, this::resolveDatabasesContainer),
                Map.entry(KIND_DATABASE, this::resolveDatabase),
                Map.entry(KIND_SCHEMAS_CONTAINER, this::resolveSchemasContainer),
                Map.entry(KIND_TABLES_FOLDER, this::resolveTables),
                Map.entry(KIND_VIEWS_FOLDER, this::resolveViews),
                Map.entry(KIND_TABLE, this::resolveTableFolders),
                Map.entry(KIND_VIEW, this::resolveTableFolders),
                Map.entry(KIND_COLUMNS_FOLDER, this::resolveColumns),
                Map.entry(KIND_INDEXES_FOLDER, this::resolveIndexes),
                Map.entry("procedures_folder", SqliteDialect::resolveEmpty),
                Map.entry("triggers_folder", SqliteDialect::resolveEmpty));
        //@formatter:on
    }

    // -- Branch resolvers --

    private List<JdbcSchemaObject> resolveConnectionRoot(JdbcConnection connection, Map<String, Object> options)
    {
        try (Connection jdbc = openSessionConnection(connection.properties()))
        {
            List<JdbcSchemaObject> children = new ArrayList<>();
            children.add(new JdbcSchemaObject("__tables__", "Tables", KIND_TABLES_FOLDER, listMasterObjects(jdbc, SQL_MASTER_TABLES, KIND_TABLE), Map.of()));
            List<JdbcSchemaObject> views = listMasterObjects(jdbc, SQL_MASTER_VIEWS, KIND_VIEW);
            if (!views.isEmpty())
            {
                children.add(new JdbcSchemaObject("__views__", "Views", KIND_VIEWS_FOLDER, views, Map.of()));
            }
            return children;
        }
        catch (SQLException e)
        {
            throw new RuntimeException(ERROR_LIST_OBJECTS, e);
        }
    }

    private List<JdbcSchemaObject> resolveDatabasesContainer(JdbcConnection connection, Map<String, Object> options)
    {
        JdbcSchemaObject defaultDb = new JdbcSchemaObject("database:default", "default", KIND_DATABASE, null, Map.of());
        return List.of(new JdbcSchemaObject("__databases__", "Databases", KIND_DATABASES_CONTAINER, List.of(defaultDb), Map.of()));
    }

    private List<JdbcSchemaObject> resolveDatabase(JdbcConnection connection, Map<String, Object> options)
    {
        JdbcSchemaObject defaultSchema = new JdbcSchemaObject("schema:default|default", "default", "schema", List.of(), Map.of("catalog", "default", "schema", "default"));
        return List.of(new JdbcSchemaObject("__schemas__:default", "Schemas", KIND_SCHEMAS_CONTAINER, List.of(defaultSchema), Map.of()));
    }

    private List<JdbcSchemaObject> resolveSchemasContainer(JdbcConnection connection, Map<String, Object> options)
    {
        return List.of(new JdbcSchemaObject("schema:default|default", "default", "schema", List.of(), Map.of("catalog", "default", "schema", "default")));
    }

    private List<JdbcSchemaObject> resolveTables(JdbcConnection connection, Map<String, Object> options)
    {
        try (Connection jdbc = openSessionConnection(connection.properties()))
        {
            return listMasterObjects(jdbc, SQL_MASTER_TABLES, KIND_TABLE);
        }
        catch (SQLException e)
        {
            throw new RuntimeException(ERROR_LIST_OBJECTS, e);
        }
    }

    private List<JdbcSchemaObject> resolveViews(JdbcConnection connection, Map<String, Object> options)
    {
        try (Connection jdbc = openSessionConnection(connection.properties()))
        {
            return listMasterObjects(jdbc, SQL_MASTER_VIEWS, KIND_VIEW);
        }
        catch (SQLException e)
        {
            throw new RuntimeException(ERROR_LIST_OBJECTS, e);
        }
    }

    private List<JdbcSchemaObject> resolveTableFolders(JdbcConnection connection, Map<String, Object> options)
    {
        return JdbcDialectSupport.resolveTableFolders(targetFrom(options.get(OPTION_TARGET)));
    }

    private List<JdbcSchemaObject> resolveColumns(JdbcConnection connection, Map<String, Object> options)
    {
        JdbcSchemaTarget target = targetFrom(options.get(OPTION_TARGET));
        if (target == null
                || target.table() == null)
        {
            return List.of();
        }
        String tableName = trimToNull(target.table());
        if (tableName == null)
        {
            return List.of();
        }

        List<JdbcSchemaObject> columns = new ArrayList<>();
        try (Connection jdbc = openSessionConnection(connection.properties()))
        {
            // Primary key columns from PRAGMA table_info
            Set<String> pkColumns = new java.util.LinkedHashSet<>();
            try (Statement stmt = jdbc.createStatement(); ResultSet rs = stmt.executeQuery("PRAGMA table_info('" + tableName.replace("'", "''") + "')"))
            {
                while (rs.next())
                {
                    if (rs.getInt("pk") > 0)
                    {
                        String colName = rs.getString("name");
                        if (colName != null)
                        {
                            pkColumns.add(colName);
                        }
                    }
                }
            }
            catch (SQLException ignored)
            {
            }

            // Foreign key columns from PRAGMA foreign_key_list
            Map<String, List<String>> fkMap = new LinkedHashMap<>();
            try (Statement stmt = jdbc.createStatement(); ResultSet rs = stmt.executeQuery("PRAGMA foreign_key_list('" + tableName.replace("'", "''") + "')"))
            {
                while (rs.next())
                {
                    String from = rs.getString("from");
                    String toTable = rs.getString("table");
                    String to = rs.getString("to");
                    if (from != null)
                    {
                        fkMap.put(from, List.of(toTable != null ? toTable
                                : "",
                                to != null ? to
                                        : ""));
                    }
                }
            }
            catch (SQLException ignored)
            {
            }

            // Column metadata from PRAGMA table_info
            try (Statement stmt = jdbc.createStatement(); ResultSet rs = stmt.executeQuery("PRAGMA table_info('" + tableName.replace("'", "''") + "')"))
            {
                while (rs.next())
                {
                    String typeName = rs.getString("type");
                    boolean notNull = rs.getBoolean("notnull");
                    int ordinal = rs.getInt("cid");

                    Map<String, Object> attrs = new LinkedHashMap<>();
                    attrs.put(KEY_TYPE, typeName != null ? typeName.toLowerCase()
                            : "unknown");
                    attrs.put("nullable", !notNull);
                    attrs.put("ordinal", ordinal);
                    String defaultValue = rs.getString("dflt_value");
                    if (defaultValue != null)
                    {
                        attrs.put("defaultValue", defaultValue);
                    }
                    String colName = rs.getString("name");
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
                    columns.add(new JdbcSchemaObject("column:" + tableName + ":" + colName, colName, "column", null, Map.copyOf(attrs)));
                }
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to read columns for " + tableName, e);
        }
        return columns;
    }

    private List<JdbcSchemaObject> resolveIndexes(JdbcConnection connection, Map<String, Object> options)
    {
        JdbcSchemaTarget target = targetFrom(options.get(OPTION_TARGET));
        if (target == null
                || target.table() == null)
        {
            return List.of();
        }
        String tableName = trimToNull(target.table());
        if (tableName == null)
        {
            return List.of();
        }

        List<JdbcSchemaObject> indexes = new ArrayList<>();
        try (Connection jdbc = openSessionConnection(connection.properties()))
        {
            // Collect index list via PRAGMA index_list
            Map<String, Boolean> uniqueMap = new LinkedHashMap<>();
            Map<String, List<Map<String, Object>>> indexColumns = new LinkedHashMap<>();

            try (Statement stmt = jdbc.createStatement(); ResultSet rs = stmt.executeQuery("PRAGMA index_list('" + tableName.replace("'", "''") + "')"))
            {
                while (rs.next())
                {
                    String indexName = rs.getString("name");
                    boolean unique = rs.getBoolean("unique");
                    if (indexName != null)
                    {
                        uniqueMap.put(indexName, unique);
                        indexColumns.put(indexName, new ArrayList<>());
                    }
                }
            }
            catch (SQLException ignored)
            {
            }

            // Resolve columns for each index via PRAGMA index_info
            for (String indexName : indexColumns.keySet())
            {
                try (Statement stmt = jdbc.createStatement(); ResultSet rs = stmt.executeQuery("PRAGMA index_info('" + indexName.replace("'", "''") + "')"))
                {
                    List<Map<String, Object>> cols = indexColumns.get(indexName);
                    while (rs.next())
                    {
                        String colName = rs.getString("name");
                        int seqno = rs.getInt("seqno");
                        if (colName != null)
                        {
                            Map<String, Object> colEntry = new LinkedHashMap<>();
                            colEntry.put("column", colName);
                            colEntry.put("ordinal", seqno);
                            cols.add(colEntry);
                        }
                    }
                }
                catch (SQLException ignored)
                {
                }
            }

            // Build index JdbcSchemaObject entries
            for (Map.Entry<String, List<Map<String, Object>>> entry : indexColumns.entrySet())
            {
                String indexName = entry.getKey();
                List<Map<String, Object>> cols = entry.getValue();

                Map<String, Object> attrs = new LinkedHashMap<>();
                Boolean unique = uniqueMap.get(indexName);
                if (unique != null)
                {
                    attrs.put("unique", unique);
                }

                List<String> columnNames = new ArrayList<>();
                List<JdbcSchemaObject> indexColumnChildren = new ArrayList<>();
                for (Map<String, Object> colInfo : cols)
                {
                    String colName = (String) colInfo.get("column");
                    if (colName != null)
                    {
                        columnNames.add(colName);
                        Number ordinal = (Number) colInfo.get("ordinal");
                        Map<String, Object> colAttrs = new LinkedHashMap<>();
                        colAttrs.put("ordinal", ordinal != null ? ordinal.intValue()
                                : 0);
                        indexColumnChildren.add(new JdbcSchemaObject("index_col:" + tableName + ":" + indexName + ":" + colName, colName, "index_column", null, Map.copyOf(colAttrs)));
                    }
                }
                if (!columnNames.isEmpty())
                {
                    attrs.put("columns", String.join(", ", columnNames));
                }
                indexes.add(new JdbcSchemaObject("index:" + tableName + ":" + indexName, indexName, "index", indexColumnChildren.isEmpty() ? null
                        : List.copyOf(indexColumnChildren), Map.copyOf(attrs)));
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to read indexes for " + tableName, e);
        }
        return indexes;
    }

    // -- Helpers --

    private static List<JdbcSchemaObject> resolveEmpty(JdbcConnection connection, Map<String, Object> options)
    {
        return List.of();
    }

    @Override
    public Connection openSessionConnection(Map<String, Object> materializedProperties) throws SQLException
    {
        String url = "jdbc:sqlite:" + stringValue(materializedProperties, "filePath");
        Properties props = new Properties();
        String password = stringValue(materializedProperties, "password");
        if (password != null)
        {
            props.setProperty("password", password);
        }
        return DriverManager.getConnection(url, props);
    }

    private static List<JdbcSchemaObject> listMasterObjects(Connection jdbc, String sql, String kind) throws SQLException
    {
        List<JdbcSchemaObject> result = new ArrayList<>();
        try (PreparedStatement stmt = jdbc.prepareStatement(sql); ResultSet rs = stmt.executeQuery())
        {
            while (rs.next())
            {
                String name = rs.getString(1);
                result.add(new JdbcSchemaObject(kind + ":" + name, name, kind, null, Map.of()));
            }
        }
        return result;
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
}
