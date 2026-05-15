package com.queryeer.backend.plugin.jdbc.sqlserver;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.nullToEmpty;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.Set;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.JdbcTreeBranch;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;
import com.queryeer.backend.queryengine.jdbc.schema.NodeType;

public final class SqlServerDialect implements JdbcDialect
{
    static final String DIALECT_ID = "sqlserver";

    private static final String KEY_CATALOG = "catalog";
    private static final String KEY_SCHEMA = "schema";
    private static final String KEY_DATABASE = "database";
    private static final String OPTION_TARGET = "target";

    private static final String SQL_DATABASES = """
            select d.name as database_name
            from sys.databases d
            where d.state = 0
            order by d.name
            """;
    private static final String SQL_SCHEMAS = """
            select s.name as schema_name
            from sys.schemas s
            where s.schema_id < 16384
            order by s.name
            """;
    private static final String SQL_TABLES = """
            select s.name as schema_name, o.name as object_name
            from sys.objects o
            join sys.schemas s
              on s.schema_id = o.schema_id
            where o.type = 'U'
            and o.is_ms_shipped = 0
            order by s.name, o.name
            """;
    private static final String SQL_VIEWS = """
            select s.name as schema_name, o.name as object_name
            from sys.objects o
            join sys.schemas s
              on s.schema_id = o.schema_id
            where o.type = 'V'
            and o.is_ms_shipped = 0
            order by s.name, o.name
            """;
    private static final String SQL_PROCEDURES = """
            select s.name as schema_name, o.name as object_name
            from sys.objects o
            join sys.schemas s
              on s.schema_id = o.schema_id
            where o.type = 'P' and o.is_ms_shipped = 0
            order by s.name, o.name
            """;
    private static final String SQL_COLUMNS = """
            select c.name as column_name, t.name as type_name, c.max_length as max_length, c.precision as numeric_precision, c.scale as numeric_scale, c.is_nullable as is_nullable
            from sys.columns c
            join sys.objects o
              on o.object_id = c.object_id
            join sys.schemas s
              on s.schema_id = o.schema_id
            join sys.types t
              on t.user_type_id = c.user_type_id
            where o.name = ?
            and s.name = ?
            and o.is_ms_shipped = 0
            order by c.column_id
            """;
    private static final String SQL_USERS = """
            select name
            from sys.server_principals
            where type = 'S'
            order by name
            """;

    private final SqlServerQueryExecutor queryExecutor = new SqlServerQueryExecutor();

    @Override
    public JdbcDialectMetadata metadata()
    {
        return new JdbcDialectMetadata(DIALECT_ID, "Microsoft SQL Server", 1433, "jdbc:sqlserver://<host>:<port>;databaseName=<database>", "com.microsoft.sqlserver.jdbc.SQLServerDriver");
    }

    @Override
    public JdbcQueryExecutor queryExecutor()
    {
        return queryExecutor;
    }

    @Override
    public java.util.Optional<com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryPlanExecutor> queryPlanExecutor()
    {
        return java.util.Optional.of(queryExecutor);
    }

    @Override
    public Map<String, JdbcSchemaResolver> branchResolvers()
    {
        return Map.ofEntries(Map.entry("databases_container", this::resolveDatabasesContainer), Map.entry("database", this::resolveDatabaseChildren),
                Map.entry("schemas_container", this::resolveSchemas), Map.entry("tables_folder", this::resolveTables), Map.entry("views_folder", this::resolveViews),
                Map.entry("procedures_folder", this::resolveProcedures), Map.entry("table", this::resolveColumns), Map.entry("view", this::resolveColumns),
                Map.entry("security_container", (_, _) -> createSecurityFolders()), Map.entry("users_folder", (c, _) -> resolveUsers(c)));
    }

    @Override
    public List<JdbcTreeBranch> treeBranches()
    {
        return List.of(new JdbcTreeBranch("connection", "security_container", NodeType.CONTAINER, "Security", null),
                new JdbcTreeBranch("security_container", "users_folder", NodeType.FOLDER, "Users", null));
    }

    @Override
    public String sqlGrammarId()
    {
        return "tsql";
    }

    @Override
    public String resolveSessionId(Connection connection) throws SQLException
    {
        try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery("select @@SPID"))
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
    public Connection openSessionConnection(Map<String, Object> materializedProperties) throws SQLException
    {
        String url = buildUrl(materializedProperties);
        Properties jdbcProps = SqlServerUrlBuilder.buildConnectionProperties(materializedProperties);
        return DriverManager.getConnection(url, jdbcProps);
    }

    @Override
    public String buildUrl(Map<String, Object> materializedProperties)
    {
        return SqlServerUrlBuilder.buildUrl(materializedProperties);
    }

    @Override
    public Map<String, Object> extractErrorDetails(Throwable throwable)
    {
        Throwable current = throwable;
        while (current != null)
        {
            Map<String, Object> details = tryExtractSqlServerErrorDetails(current);
            if (!details.isEmpty())
            {
                return details;
            }
            current = current.getCause();
        }
        return Map.of();
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
            throw new RuntimeException("Failed to list databases", e);
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
            DatabaseMetaData metadata = conn.getMetaData();

            // Collect PK and FK column info
            Set<String> pkColumns = new HashSet<>();
            try (ResultSet rs = metadata.getPrimaryKeys(null, schema, table))
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
            try (ResultSet rs = metadata.getImportedKeys(null, schema, table))
            {
                while (rs.next())
                {
                    String col = rs.getString("FKCOLUMN_NAME");
                    String refTable = rs.getString("PKTABLE_NAME");
                    String refCol = rs.getString("PKCOLUMN_NAME");
                    if (col != null)
                    {
                        fkMap.put(col, List.of(nullToEmpty(refTable), nullToEmpty(refCol)));
                    }
                }
            }
            catch (SQLException ignored)
            {
            }

            try (PreparedStatement statement = conn.prepareStatement(SQL_COLUMNS))
            {
                statement.setString(1, table);
                statement.setString(2, schema);
                try (ResultSet rs = statement.executeQuery())
                {
                    while (rs.next())
                    {
                        String typeName = rs.getString("type_name");
                        Integer size = toNullableInteger(rs.getObject("max_length"));
                        String nullable = Boolean.TRUE.equals(rs.getObject("is_nullable")) ? "YES"
                                : "NO";

                        Map<String, Object> attrs = new LinkedHashMap<>();
                        attrs.put("type", typeName != null ? typeName.toLowerCase()
                                : "unknown");
                        attrs.put("nullable", nullable);
                        if (size != null)
                        {
                            attrs.put("size", size);
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

    private List<JdbcSchemaObject> createSecurityFolders()
    {
        return List.of(new JdbcSchemaObject("__users_folder__", "Users", "users_folder", null, Map.of()));
    }

    private List<JdbcSchemaObject> resolveUsers(JdbcConnection connection)
    {
        List<JdbcSchemaObject> users = new ArrayList<>();
        try (Connection jdbc = openSessionConnection(connection.properties()); PreparedStatement statement = jdbc.prepareStatement(SQL_USERS); ResultSet rs = statement.executeQuery())
        {
            while (rs.next())
            {
                users.add(new JdbcSchemaObject("user:" + rs.getString("name"), rs.getString("name"), "user", null, Map.of()));
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to list users", e);
        }
        return users;
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

    private static Connection openForDatabase(JdbcConnection connection, String database) throws SQLException
    {
        String url = SqlServerUrlBuilder.buildUrl(connection.properties());
        Properties props = SqlServerUrlBuilder.buildConnectionProperties(connection.properties());
        if (!isBlank(database))
        {
            props.setProperty("databaseName", database);
        }
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

    private static Map<String, Object> tryExtractSqlServerErrorDetails(Throwable throwable)
    {
        try
        {
            Class<?> cls = Class.forName("com.microsoft.sqlserver.jdbc.SQLServerException");
            if (!cls.isInstance(throwable))
            {
                return Map.of();
            }
            Method getSqlServerError = cls.getMethod("getSQLServerError");
            Object error = getSqlServerError.invoke(throwable);
            if (error == null)
            {
                return Map.of();
            }
            Class<?> ec = error.getClass();
            Map<String, Object> details = new LinkedHashMap<>();
            Object line = ec.getMethod("getLineNumber")
                    .invoke(error);
            if (line instanceof Number n
                    && n.intValue() > 0)
            {
                details.put("line", n.intValue());
            }
            Object errNum = ec.getMethod("getErrorNumber")
                    .invoke(error);
            if (errNum instanceof Number n)
            {
                details.put("sqlErrorNumber", n.intValue());
            }
            Object proc = ec.getMethod("getProcedureName")
                    .invoke(error);
            if (proc instanceof String s
                    && !s.isBlank())
            {
                details.put("procedure", s);
            }
            Object state = ec.getMethod("getErrorState")
                    .invoke(error);
            if (state instanceof Number n)
            {
                details.put("state", n.intValue());
            }
            return details;
        }
        catch (ReflectiveOperationException | LinkageError ignored)
        {
            return Map.of();
        }
    }
}
