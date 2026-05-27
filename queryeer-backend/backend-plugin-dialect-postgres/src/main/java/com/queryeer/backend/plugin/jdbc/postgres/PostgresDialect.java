package com.queryeer.backend.plugin.jdbc.postgres;

import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static com.queryeer.backend.api.PayloadUtils.toNullableInteger;
import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.lang.reflect.Method;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Properties;
import java.util.Set;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectSupport;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryPlanExecutor;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

public final class PostgresDialect implements JdbcDialect
{
    static final String DIALECT_ID = "postgres";

    private static final String KEY_CATALOG = "catalog";
    private static final String KEY_SCHEMA = "schema";
    private static final String KEY_DATABASE = "database";
    private static final String OPTION_TARGET = "target";

    // @formatter:off — PostgreSQL schema queries

    private static final String SQL_DATABASES = """
            SELECT datname AS database_name
            FROM pg_database
            WHERE datistemplate = false
            ORDER BY datname
            """;

    private static final String SQL_SCHEMAS = """
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
            ORDER BY schema_name
            """;

    private static final String SQL_TABLES = """
            SELECT table_schema AS schema_name, table_name AS object_name
            FROM information_schema.tables
            WHERE table_type = 'BASE TABLE'
            AND table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name
            """;

    private static final String SQL_VIEWS = """
            SELECT table_schema AS schema_name, table_name AS object_name
            FROM information_schema.views
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name
            """;

    private static final String SQL_PROCEDURES = """
            SELECT specific_schema AS schema_name, routine_name AS object_name
            FROM information_schema.routines
            WHERE routine_type = 'PROCEDURE'
            AND specific_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY specific_schema, routine_name
            """;

    private static final String SQL_TRIGGERS = """
            SELECT event_object_schema AS schema_name, trigger_name AS object_name
            FROM information_schema.triggers
            WHERE event_object_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY event_object_schema, trigger_name
            """;

    private static final String SQL_COLUMNS = """
            SELECT c.column_name, c.data_type, c.is_nullable, c.ordinal_position,
                   COALESCE(c.character_maximum_length, c.numeric_precision) AS max_length,
                   c.numeric_precision, c.numeric_scale
            FROM information_schema.columns c
            WHERE c.table_name = ?
            AND c.table_schema = ?
            ORDER BY c.ordinal_position
            """;

    private static final String SQL_INDEXES = """
            SELECT i.relname AS index_name,
                   a.attname AS column_name,
                   ix.indisunique AS is_unique,
                   ix.indisprimary AS is_primary_key,
                   a.attnum AS key_ordinal,
                   CASE WHEN opclass.opcdefault = false THEN 'DESC' ELSE 'ASC' END AS sort_order
            FROM pg_class t
            JOIN pg_index ix ON t.oid = ix.indrelid
            JOIN pg_class i ON i.oid = ix.indexrelid
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
            JOIN pg_namespace n ON n.oid = t.relnamespace
            LEFT JOIN pg_opclass opclass ON opclass.oid = ix.indclass[a.attnum - 1]
            WHERE t.relname = ?
            AND n.nspname = ?
            AND t.relkind = 'r'
            ORDER BY i.relname, a.attnum
            """;

    // @formatter:on

    private final PostgresQueryExecutor queryExecutor = new PostgresQueryExecutor();

    @Override
    public JdbcDialectMetadata metadata()
    {
        return new JdbcDialectMetadata(DIALECT_ID, "PostgreSQL", 5432, "jdbc:postgresql://<host>:<port>/<database>", "org.postgresql.Driver");
    }

    @Override
    public JdbcQueryExecutor queryExecutor()
    {
        return queryExecutor;
    }

    @Override
    public Optional<JdbcQueryPlanExecutor> queryPlanExecutor()
    {
        return Optional.of(queryExecutor);
    }

    @Override
    public Map<String, JdbcSchemaResolver> branchResolvers()
    {
        //@formatter:off
        return Map.ofEntries(
                Map.entry("databases_container", this::resolveDatabasesContainer),
                Map.entry("database", this::resolveDatabaseChildren),
                Map.entry("schemas_container", this::resolveSchemas),
                Map.entry("tables_folder", this::resolveTables),
                Map.entry("views_folder", this::resolveViews),
                Map.entry("procedures_folder", this::resolveProcedures),
                Map.entry("triggers_folder", this::resolveTriggers),
                Map.entry("table", this::resolveTableFolders),
                Map.entry("view", this::resolveTableFolders),
                Map.entry("columns_folder", this::resolveColumns),
                Map.entry("indexes_folder", this::resolveIndexes));
        //@formatter:on
    }

    @Override
    public String sqlGrammarId()
    {
        return "postgres";
    }

    /**
     * PostgreSQL cannot switch databases within an existing connection.
     */
    @Override
    public boolean canSwitchDatabase()
    {
        return false;
    }

    /**
     * No-op — database selection is handled at connection-open time by rebuilding the JDBC URL with the target database.
     */
    @Override
    public void applyDatabase(Connection connection, String database)
    {
    }

    /**
     * Returns {@code null} so the frontend keeps the user-selected database rather than reverting to the connection's initial catalog.
     */
    @Override
    public String resolveCurrentDatabase(Connection connection)
    {
        return null;
    }

    @Override
    public String resolveSessionId(Connection connection) throws SQLException
    {
        try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery("SELECT pg_backend_pid()"))
        {
            if (!rs.next())
            {
                return "";
            }
            Object value = rs.getObject(1);
            return value == null ? ""
                    : String.valueOf(value)
                            .trim();
        }
        catch (SQLException ignored)
        {
            return "";
        }
    }

    @Override
    public Map<String, Object> extractErrorDetails(Throwable throwable)
    {
        Throwable current = throwable;
        while (current != null)
        {
            Map<String, Object> details = tryExtractPostgresErrorDetails(current);
            if (!details.isEmpty())
            {
                return details;
            }
            current = current.getCause();
        }
        return Map.of();
    }

    @Override
    public Connection openSessionConnection(Map<String, Object> materializedProperties) throws SQLException
    {
        String url = PostgresUrlBuilder.buildUrl(materializedProperties);
        Properties jdbcProps = PostgresUrlBuilder.buildConnectionProperties(materializedProperties);
        return DriverManager.getConnection(url, jdbcProps);
    }

    @Override
    public String buildUrl(Map<String, Object> materializedProperties)
    {
        return PostgresUrlBuilder.buildUrl(materializedProperties);
    }

    // -- Branch resolvers --

    private List<JdbcSchemaObject> resolveDatabasesContainer(JdbcConnection connection, Map<String, Object> options)
    {
        try (Connection jdbc = openSessionConnection(connection.properties()); PreparedStatement statement = jdbc.prepareStatement(SQL_DATABASES); ResultSet rs = statement.executeQuery())
        {
            List<JdbcSchemaObject> databases = new ArrayList<>();
            while (rs.next())
            {
                databases.add(new JdbcSchemaObject(rs.getString("database_name"), rs.getString("database_name"), "database", null, Map.of()));
            }
            return List.of(new JdbcSchemaObject("__databases__", "Databases", "databases_container", databases, Map.of()));
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to list PostgreSQL databases", e);
        }
    }

    private List<JdbcSchemaObject> resolveDatabaseChildren(JdbcConnection connection, Map<String, Object> options)
    {
        JdbcSchemaTarget target = targetFrom(options.get(OPTION_TARGET));
        return List.of(new JdbcSchemaObject("__schemas__", "Schemas", "schemas_container", listSchemas(connection, target), Map.of()));
    }

    private List<JdbcSchemaObject> resolveSchemas(JdbcConnection connection, Map<String, Object> options)
    {
        return listSchemas(connection, targetFrom(options.get(OPTION_TARGET)));
    }

    private List<JdbcSchemaObject> resolveTables(JdbcConnection connection, Map<String, Object> options)
    {
        return listObjects(connection, targetFrom(options.get(OPTION_TARGET)), SQL_TABLES, "table");
    }

    private List<JdbcSchemaObject> resolveViews(JdbcConnection connection, Map<String, Object> options)
    {
        return listObjects(connection, targetFrom(options.get(OPTION_TARGET)), SQL_VIEWS, "view");
    }

    private List<JdbcSchemaObject> resolveProcedures(JdbcConnection connection, Map<String, Object> options)
    {
        return listObjects(connection, targetFrom(options.get(OPTION_TARGET)), SQL_PROCEDURES, "procedure");
    }

    private List<JdbcSchemaObject> resolveTriggers(JdbcConnection connection, Map<String, Object> options)
    {
        return listObjects(connection, targetFrom(options.get(OPTION_TARGET)), SQL_TRIGGERS, "trigger");
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
        String database = trimToNull(target.database());
        String schema = trimToNull(target.schema());
        String table = trimToNull(target.table());
        if (schema == null
                || table == null)
        {
            return List.of();
        }

        List<JdbcSchemaObject> columns = new ArrayList<>();
        try (Connection conn = openForDatabase(connection, database))
        {
            DatabaseMetaData meta = conn.getMetaData();
            Set<String> pkColumns = JdbcDialectSupport.collectPrimaryKeys(meta, null, schema, table);
            Map<String, List<String>> fkMap = JdbcDialectSupport.collectForeignKeys(meta, null, schema, table);

            try (PreparedStatement statement = conn.prepareStatement(SQL_COLUMNS))
            {
                statement.setString(1, table);
                statement.setString(2, schema);
                try (ResultSet rs = statement.executeQuery())
                {
                    while (rs.next())
                    {
                        String typeName = rs.getString("data_type");
                        String nullable = rs.getString("is_nullable");
                        Integer maxLength = toNullableInteger(rs.getObject("max_length"));

                        Map<String, Object> attrs = new LinkedHashMap<>();
                        attrs.put("type", typeName != null ? typeName.toLowerCase()
                                : "unknown");
                        if (nullable != null)
                        {
                            attrs.put("nullable", nullable);
                        }
                        if (maxLength != null)
                        {
                            attrs.put("size", maxLength);
                        }
                        Integer precision = toNullableInteger(rs.getObject("numeric_precision"));
                        if (precision != null)
                        {
                            attrs.put("precision", precision);
                        }
                        Integer scale = toNullableInteger(rs.getObject("numeric_scale"));
                        if (scale != null)
                        {
                            attrs.put("scale", scale);
                        }
                        String colName = rs.getString("column_name");
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
                        String id = database + "." + schema + "." + table + "." + colName;
                        columns.add(new JdbcSchemaObject(id, colName, "column", null, Map.copyOf(attrs)));
                    }
                }
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to read columns for " + schema + "." + table, e);
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
        String database = trimToNull(target.database());
        String schema = trimToNull(target.schema());
        String table = trimToNull(target.table());
        if (schema == null
                || table == null)
        {
            return List.of();
        }

        List<JdbcSchemaObject> indexes = new ArrayList<>();
        try (Connection conn = openForDatabase(connection, database))
        {
            try (PreparedStatement statement = conn.prepareStatement(SQL_INDEXES))
            {
                statement.setString(1, table);
                statement.setString(2, schema);
                try (ResultSet rs = statement.executeQuery())
                {
                    Map<String, List<String>> indexColumns = new LinkedHashMap<>();
                    Map<String, Short> indexOrdinalMap = new LinkedHashMap<>();
                    Map<String, String> indexSortMap = new LinkedHashMap<>();
                    Map<String, Boolean> indexUnique = new LinkedHashMap<>();
                    Map<String, Boolean> indexPrimaryKey = new LinkedHashMap<>();
                    while (rs.next())
                    {
                        String indexName = rs.getString("index_name");
                        String colName = rs.getString("column_name");
                        boolean isUnique = rs.getBoolean("is_unique");
                        boolean isPrimaryKey = rs.getBoolean("is_primary_key");
                        short keyOrdinal = rs.getShort("key_ordinal");
                        String sortOrder = rs.getString("sort_order");
                        if (indexName != null
                                && colName != null)
                        {
                            indexColumns.computeIfAbsent(indexName, _ -> new ArrayList<>())
                                    .add(colName);
                            indexOrdinalMap.putIfAbsent(indexName + ":" + colName, keyOrdinal);
                            indexSortMap.putIfAbsent(indexName + ":" + colName, sortOrder != null ? sortOrder
                                    : "ASC");
                            indexUnique.putIfAbsent(indexName, isUnique);
                            indexPrimaryKey.putIfAbsent(indexName, isPrimaryKey);
                        }
                    }
                    String idPrefix = (database != null ? database + "."
                            : "") + schema + "." + table;
                    for (Map.Entry<String, List<String>> entry : indexColumns.entrySet())
                    {
                        Map<String, Object> attrs = new LinkedHashMap<>();
                        attrs.put("columns", String.join(", ", entry.getValue()));
                        Boolean unique = indexUnique.get(entry.getKey());
                        if (unique != null)
                        {
                            attrs.put("unique", unique);
                        }
                        Boolean pk = indexPrimaryKey.get(entry.getKey());
                        if (pk != null
                                && pk)
                        {
                            attrs.put("primaryKey", true);
                        }
                        List<JdbcSchemaObject> indexColumnChildren = new ArrayList<>();
                        int pos = 0;
                        for (String colName : entry.getValue())
                        {
                            pos++;
                            Short ord = indexOrdinalMap.get(entry.getKey() + ":" + colName);
                            String sortOrder = indexSortMap.get(entry.getKey() + ":" + colName);
                            Map<String, Object> colAttrs = new LinkedHashMap<>();
                            colAttrs.put("ordinal", ord != null ? ord
                                    : pos);
                            if (sortOrder != null)
                            {
                                colAttrs.put("sortOrder", sortOrder);
                            }
                            indexColumnChildren.add(new JdbcSchemaObject("index_col:" + idPrefix + ":" + entry.getKey() + ":" + colName, colName, "index_column", null, Map.copyOf(colAttrs)));
                        }
                        indexes.add(new JdbcSchemaObject("index:" + idPrefix + ":" + entry.getKey(), entry.getKey(), "index", indexColumnChildren.isEmpty() ? null
                                : List.copyOf(indexColumnChildren), Map.copyOf(attrs)));
                    }
                }
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to read indexes for " + schema + "." + table, e);
        }
        return indexes;
    }

    // -- Helpers --

    private List<JdbcSchemaObject> listSchemas(JdbcConnection connection, JdbcSchemaTarget target)
    {
        String database = target != null ? trimToNull(target.database())
                : null;
        if (database == null)
        {
            return List.of();
        }
        List<JdbcSchemaObject> schemas = new ArrayList<>();
        try (Connection conn = openForDatabase(connection, database); PreparedStatement statement = conn.prepareStatement(SQL_SCHEMAS); ResultSet rs = statement.executeQuery())
        {
            while (rs.next())
            {
                schemas.add(new JdbcSchemaObject(database + "." + rs.getString("schema_name"), rs.getString("schema_name"), "schema", List.of(), Map.of(KEY_CATALOG, database)));
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to list schemas for " + database, e);
        }
        return schemas;
    }

    private List<JdbcSchemaObject> listObjects(JdbcConnection connection, JdbcSchemaTarget target, String sql, String kind)
    {
        String database = target != null ? trimToNull(target.database())
                : null;
        String schemaFilter = target != null ? trimToNull(target.schema())
                : null;
        List<JdbcSchemaObject> result = new ArrayList<>();
        try (Connection conn = openForDatabase(connection, database); PreparedStatement statement = conn.prepareStatement(sql); ResultSet rs = statement.executeQuery())
        {
            while (rs.next())
            {
                String schemaName = rs.getString("schema_name");
                String objName = rs.getString("object_name");
                if (schemaFilter != null
                        && !schemaFilter.equalsIgnoreCase(schemaName))
                {
                    continue;
                }
                String fullName = schemaName + "." + objName;
                Map<String, Object> attrs = new LinkedHashMap<>();
                if (database != null)
                {
                    attrs.put(KEY_CATALOG, database);
                }
                attrs.put(KEY_SCHEMA, schemaName);
                result.add(new JdbcSchemaObject(kind + ":" + database + "." + schemaName + "." + objName, objName, kind, null, fullName, null, Map.copyOf(attrs)));
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to list " + kind + "s for " + database, e);
        }
        return result;
    }

    private static Connection openForDatabase(JdbcConnection connection, String database) throws SQLException
    {
        String url = PostgresUrlBuilder.buildUrlForDatabase(connection.properties(), database);
        Properties props = PostgresUrlBuilder.buildConnectionProperties(connection.properties());
        return DriverManager.getConnection(url, props);
    }

    private static JdbcSchemaTarget targetFrom(Object value)
    {
        if (value instanceof JdbcSchemaTarget t)
        {
            return t;
        }
        if (value instanceof Map<?, ?> map)
        {
            String database = trimToNull(stringValue(map, KEY_DATABASE));
            String schema = trimToNull(stringValue(map, KEY_SCHEMA));
            String table = trimToNull(stringValue(map, "table"));
            return new JdbcSchemaTarget(database, schema, table);
        }
        return null;
    }

    /**
     * Uses reflection to access {@code org.postgresql.util.PSQLException} and its {@code ServerErrorMessage} to extract position, hint, detail, schema, table, column, and constraint info that
     * PostgreSQL attaches to SQL errors. The PostgreSQL driver jar is a runtime-only dependency not present at compile time.
     */
    private static Map<String, Object> tryExtractPostgresErrorDetails(Throwable throwable)
    {
        try
        {
            Class<?> psqlExClass = Class.forName("org.postgresql.util.PSQLException");
            if (!psqlExClass.isInstance(throwable))
            {
                return Map.of();
            }
            Method getServerError = psqlExClass.getMethod("getServerErrorMessage");
            Object errorMsg = getServerError.invoke(throwable);
            if (errorMsg == null)
            {
                return Map.of();
            }
            Class<?> emClass = errorMsg.getClass();
            Map<String, Object> details = new LinkedHashMap<>();

            // Character position in the SQL string (useful for editor highlighting)
            Object position = emClass.getMethod("getPosition")
                    .invoke(errorMsg);
            if (position instanceof Number n
                    && n.intValue() > 0)
            {
                details.put("position", n.intValue());
            }

            Object severity = emClass.getMethod("getSeverity")
                    .invoke(errorMsg);
            if (severity instanceof String s
                    && !s.isBlank())
            {
                details.put("severity", s);
            }

            Object sqlState = emClass.getMethod("getSQLState")
                    .invoke(errorMsg);
            if (sqlState instanceof String s
                    && !s.isBlank())
            {
                details.put("sqlState", s);
            }

            Object detail = emClass.getMethod("getDetail")
                    .invoke(errorMsg);
            if (detail instanceof String s
                    && !s.isBlank())
            {
                details.put("detail", s);
            }

            Object hint = emClass.getMethod("getHint")
                    .invoke(errorMsg);
            if (hint instanceof String s
                    && !s.isBlank())
            {
                details.put("hint", s);
            }

            Object schema = emClass.getMethod("getSchema")
                    .invoke(errorMsg);
            if (schema instanceof String s
                    && !s.isBlank())
            {
                details.put("schema", s);
            }

            Object table = emClass.getMethod("getTable")
                    .invoke(errorMsg);
            if (table instanceof String s
                    && !s.isBlank())
            {
                details.put("table", s);
            }

            Object column = emClass.getMethod("getColumn")
                    .invoke(errorMsg);
            if (column instanceof String s
                    && !s.isBlank())
            {
                details.put("column", s);
            }

            Object constraint = emClass.getMethod("getConstraint")
                    .invoke(errorMsg);
            if (constraint instanceof String s
                    && !s.isBlank())
            {
                details.put("constraint", s);
            }

            Object routine = emClass.getMethod("getRoutine")
                    .invoke(errorMsg);
            if (routine instanceof String s
                    && !s.isBlank())
            {
                details.put("routine", s);
            }

            Object where = emClass.getMethod("getWhere")
                    .invoke(errorMsg);
            if (where instanceof String s
                    && !s.isBlank())
            {
                details.put("where", s);
            }

            return details;
        }
        catch (ReflectiveOperationException | LinkageError ignored)
        {
            return Map.of();
        }
    }
}
