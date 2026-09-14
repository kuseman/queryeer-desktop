package com.queryeer.backend.plugin.jdbc.sqlserver;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static com.queryeer.backend.api.PayloadUtils.toNullableInteger;
import static com.queryeer.backend.api.PayloadUtils.trimToNull;
import static java.util.Optional.of;

import java.lang.reflect.Method;
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
import java.util.Optional;
import java.util.Properties;

import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectSupport;
import com.queryeer.backend.queryengine.jdbc.JdbcTreeBranch;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryPlanExecutor;
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
            select s.name as schema_name, o.name as object_name, o.object_id
            from sys.objects o
            join sys.schemas s
              on s.schema_id = o.schema_id
            where o.type = 'P' and o.is_ms_shipped = 0
            order by s.name, o.name
            """;

    private static final String SQL_PARAMETERS = """
            select p.name as parameter_name, t.name as type_name, p.is_output as is_output, p.parameter_id as ordinal
            from sys.parameters p
            join sys.types t
              on t.user_type_id = p.user_type_id
            where p.object_id = ?
            order by p.parameter_id
            """;
    private static final String SQL_TRIGGERS = """
            select s.name as schema_name, tr.name as object_name
            from sys.triggers tr
            join sys.tables t
              on t.object_id = tr.parent_id
            join sys.schemas s
              on s.schema_id = t.schema_id
            where tr.is_ms_shipped = 0
            order by s.name, tr.name
            """;
    static final String SQL_COLUMNS = """
            select c.name as column_name,
                   t.name as type_name,
                   c.max_length as max_length,
                   c.precision as numeric_precision,
                   c.scale as numeric_scale,
                   c.is_nullable as is_nullable,
                   convert(bit, case when exists (
                       select 1
                       from sys.indexes i
                       join sys.index_columns ic
                         on ic.object_id = i.object_id
                        and ic.index_id = i.index_id
                       where i.object_id = c.object_id
                         and ic.column_id = c.column_id
                         and i.is_primary_key = 1
                   ) then 1 else 0 end) as is_primary_key,
                   fk.referenced_schema,
                   fk.referenced_table,
                   fk.referenced_column
            from sys.columns c
            join sys.objects o
              on o.object_id = c.object_id
            join sys.schemas s
              on s.schema_id = o.schema_id
            join sys.types t
              on t.user_type_id = c.user_type_id
            outer apply (
                select top (1)
                       referenced_schema = rs.name,
                       referenced_table = ro.name,
                       referenced_column = rc.name
                from sys.foreign_key_columns fkc
                join sys.objects ro
                  on ro.object_id = fkc.referenced_object_id
                join sys.schemas rs
                  on rs.schema_id = ro.schema_id
                join sys.columns rc
                  on rc.object_id = fkc.referenced_object_id
                 and rc.column_id = fkc.referenced_column_id
                where fkc.parent_object_id = c.object_id
                  and fkc.parent_column_id = c.column_id
                order by fkc.constraint_object_id
            ) fk
            where o.name = ?
            and s.name = ?
            and o.is_ms_shipped = 0
            order by c.column_id
            """;
    private static final String SQL_INDEXES = """
            select i.name as index_name, c.name as column_name, i.is_unique, i.is_primary_key, ic.key_ordinal, ic.is_descending_key
            from sys.indexes i
            join sys.index_columns ic
              on ic.object_id = i.object_id
              and ic.index_id = i.index_id
            join sys.columns c
              on c.object_id = i.object_id
              and c.column_id = ic.column_id
            join sys.objects o
              on o.object_id = i.object_id
            join sys.schemas s
              on s.schema_id = o.schema_id
            where o.name = ?
            and s.name = ?
            and i.is_hypothetical = 0
            order by i.name, ic.key_ordinal
            """;
    private static final String SQL_USERS = """
            select name
            from sys.server_principals
            where type = 'S'
            order by name
            """;
    private static final String SQL_DEEP_OBJECTS = """
            select o.object_id, s.name as schema_name, o.name as object_name, o.type as object_type
            from sys.objects o
            join sys.schemas s on s.schema_id = o.schema_id
            where o.type in ('U', 'V') and o.is_ms_shipped = 0
            and (? is null or s.name = ?)
            order by o.type desc, s.name, o.name
            """;
    private static final String SQL_DEEP_COLUMNS = """
            select o.object_id, s.name as schema_name, o.name as object_name,
                   c.name as column_name, t.name as type_name, c.max_length,
                   c.precision as numeric_precision, c.scale as numeric_scale,
                   c.is_nullable,
                   convert(bit, case when exists (
                       select 1 from sys.indexes i
                       join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id
                       where i.object_id = c.object_id and ic.column_id = c.column_id and i.is_primary_key = 1
                   ) then 1 else 0 end) as is_primary_key,
                   fk.referenced_schema, fk.referenced_table, fk.referenced_column
            from sys.columns c
            join sys.objects o on o.object_id = c.object_id
            join sys.schemas s on s.schema_id = o.schema_id
            join sys.types t on t.user_type_id = c.user_type_id
            outer apply (
                select top (1) rs.name as referenced_schema, ro.name as referenced_table, rc.name as referenced_column
                from sys.foreign_key_columns fkc
                join sys.objects ro on ro.object_id = fkc.referenced_object_id
                join sys.schemas rs on rs.schema_id = ro.schema_id
                join sys.columns rc on rc.object_id = fkc.referenced_object_id and rc.column_id = fkc.referenced_column_id
                where fkc.parent_object_id = c.object_id and fkc.parent_column_id = c.column_id
                order by fkc.constraint_object_id
            ) fk
            where o.type in ('U', 'V') and o.is_ms_shipped = 0
            and (? is null or s.name = ?)
            order by o.object_id, c.column_id
            """;
    private static final String SQL_DEEP_INDEXES = """
            select o.object_id, s.name as schema_name, o.name as object_name,
                   i.index_id, i.name as index_name, c.name as column_name,
                   i.is_unique, i.is_primary_key, ic.key_ordinal, ic.is_descending_key
            from sys.indexes i
            join sys.index_columns ic on ic.object_id = i.object_id and ic.index_id = i.index_id
            join sys.columns c on c.object_id = i.object_id and c.column_id = ic.column_id
            join sys.objects o on o.object_id = i.object_id
            join sys.schemas s on s.schema_id = o.schema_id
            where o.type in ('U', 'V') and o.is_ms_shipped = 0 and i.is_hypothetical = 0
            and i.name is not null and (? is null or s.name = ?)
            order by o.object_id, i.index_id, ic.key_ordinal, ic.index_column_id
            """;
    private static final String SQL_DEEP_PROCEDURES = """
            select o.object_id, s.name as schema_name, o.name as object_name,
                   p.name as parameter_name, t.name as type_name, p.is_output, p.parameter_id as ordinal
            from sys.objects o
            join sys.schemas s on s.schema_id = o.schema_id
            left join sys.parameters p on p.object_id = o.object_id
            left join sys.types t on t.user_type_id = p.user_type_id
            where o.type = 'P' and o.is_ms_shipped = 0
            and (? is null or s.name = ?)
            order by s.name, o.name, p.parameter_id
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
    public Optional<JdbcQueryPlanExecutor> queryPlanExecutor()
    {
        return of(queryExecutor);
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
                Map.entry("columns_folder", this::resolveColumnsRaw),
                Map.entry("indexes_folder", this::resolveIndexes),
                Map.entry("security_container", (_, _) -> createSecurityFolders()),
                Map.entry("users_folder", (c, _) -> resolveUsers(c)));
        //@formatter:on
    }

    @Override
    public Optional<com.queryeer.backend.queryengine.jdbc.schema.JdbcDeepSchemaResolver> deepSchemaResolver()
    {
        return Optional.of(this::resolveDeepSchema);
    }

    @Override
    public List<JdbcTreeBranch> treeBranches()
    {
        //@formatter:off
        return List.of(
                new JdbcTreeBranch("connection", "security_container", NodeType.CONTAINER, "Security", null),
                new JdbcTreeBranch("security_container", "users_folder", NodeType.FOLDER, "Users", null));
        //@formatter:on
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
        JdbcSchemaTarget target = targetFrom(options.get(OPTION_TARGET));
        String database = target != null ? trimToNull(target.database())
                : null;
        String schemaFilter = target != null ? trimToNull(target.schema())
                : null;
        List<JdbcSchemaObject> result = new ArrayList<>();
        try (Connection conn = openForDatabase(connection, database);
                PreparedStatement statement = conn.prepareStatement(SQL_PROCEDURES);
                PreparedStatement paramStatement = conn.prepareStatement(SQL_PARAMETERS);
                ResultSet rs = statement.executeQuery())
        {
            while (rs.next())
            {
                String schemaName = rs.getString("schema_name");
                String procName = rs.getString("object_name");
                if (schemaFilter != null
                        && !schemaFilter.equalsIgnoreCase(schemaName))
                {
                    continue;
                }
                String fullName = schemaName + "." + procName;
                Map<String, Object> attrs = new LinkedHashMap<>();
                if (database != null)
                {
                    attrs.put(KEY_CATALOG, database);
                }
                attrs.put(KEY_SCHEMA, schemaName);
                long objectId = rs.getLong("object_id");
                List<JdbcSchemaObject> params = readProcedureParameters(paramStatement, objectId);
                result.add(new JdbcSchemaObject("procedure:" + database + "." + schemaName + "." + procName, procName, "procedure", null, fullName, params, Map.copyOf(attrs)));
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to list procedures for " + database, e);
        }
        return result;
    }

    private static List<JdbcSchemaObject> readProcedureParameters(PreparedStatement paramStatement, long objectId) throws SQLException
    {
        paramStatement.setLong(1, objectId);
        List<JdbcSchemaObject> params = new ArrayList<>();
        try (ResultSet prs = paramStatement.executeQuery())
        {
            while (prs.next())
            {
                String typeName = prs.getString("type_name");
                boolean isOutput = prs.getBoolean("is_output");
                int ordinal = prs.getInt("ordinal");
                Map<String, Object> paramAttrs = new LinkedHashMap<>();
                paramAttrs.put("type", typeName != null ? typeName.toLowerCase()
                        : "unknown");
                paramAttrs.put("mode", isOutput ? "OUT"
                        : "IN");
                paramAttrs.put("ordinal", ordinal);
                String paramName = prs.getString("parameter_name");
                params.add(new JdbcSchemaObject("param:" + objectId + ":" + paramName, paramName, "parameter", null, Map.copyOf(paramAttrs)));
            }
        }
        return params;
    }

    private List<JdbcSchemaObject> resolveTriggers(JdbcConnection connection, Map<String, Object> options)
    {
        return listObjects(connection, targetFrom(options.get(OPTION_TARGET)), SQL_TRIGGERS, "trigger");
    }

    private List<JdbcSchemaObject> resolveTableFolders(JdbcConnection connection, Map<String, Object> options)
    {
        return JdbcDialectSupport.resolveTableFolders(targetFrom(options.get(OPTION_TARGET)));
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
                        boolean isDescending = rs.getBoolean("is_descending_key");
                        if (indexName != null
                                && colName != null)
                        {
                            indexColumns.computeIfAbsent(indexName, _ -> new ArrayList<>())
                                    .add(colName);
                            indexOrdinalMap.putIfAbsent(indexName + ":" + colName, keyOrdinal);
                            indexSortMap.putIfAbsent(indexName + ":" + colName, isDescending ? "DESC"
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

    private List<JdbcSchemaObject> resolveColumnsRaw(JdbcConnection connection, Map<String, Object> options)
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
                        applyKeyMetadata(rs, attrs);
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

    private List<JdbcSchemaObject> resolveDeepSchema(JdbcConnection connection, JdbcSchemaTarget target)
    {
        String database = trimToNull(target.database());
        String schema = trimToNull(target.schema());
        try (Connection conn = openForDatabase(connection, database))
        {
            String effectiveDatabase = database != null ? database
                    : conn.getCatalog();
            List<DeepObject> objects = readDeepObjects(conn, schema);
            Map<Long, List<JdbcSchemaObject>> columnsByObject = readDeepColumns(conn, schema, effectiveDatabase);
            Map<Long, List<JdbcSchemaObject>> indexesByObject = readDeepIndexes(conn, schema, effectiveDatabase);
            List<JdbcSchemaObject> result = new ArrayList<>();
            for (DeepObject object : objects)
            {
                Map<String, Object> attrs = objectAttributes(effectiveDatabase, object.schema());
                Map<String, Object> folderAttrs = new LinkedHashMap<>(attrs);
                folderAttrs.put("table", object.name());
                List<JdbcSchemaObject> children = new ArrayList<>();
                List<JdbcSchemaObject> columns = columnsByObject.getOrDefault(object.objectId(), List.of());
                if (!columns.isEmpty())
                {
                    children.add(
                            new JdbcSchemaObject("columns_folder:" + key(effectiveDatabase, object.schema()) + ":" + object.name(), "Columns", "columns_folder", columns, Map.copyOf(folderAttrs)));
                }
                List<JdbcSchemaObject> indexes = indexesByObject.getOrDefault(object.objectId(), List.of());
                if (!indexes.isEmpty())
                {
                    children.add(
                            new JdbcSchemaObject("indexes_folder:" + key(effectiveDatabase, object.schema()) + ":" + object.name(), "Indexes", "indexes_folder", indexes, Map.copyOf(folderAttrs)));
                }
                String kind = "U".equals(object.type()) ? "table"
                        : "view";
                result.add(new JdbcSchemaObject(kind + ":" + effectiveDatabase + "." + object.schema() + "." + object.name(), object.name(), kind, null, object.schema() + "." + object.name(),
                        List.copyOf(children), attrs));
            }
            result.addAll(readDeepProcedures(conn, schema, effectiveDatabase));
            return result;
        }
        catch (SQLException e)
        {
            throw new RuntimeException("Failed to crawl schema for " + database, e);
        }
    }

    private static List<DeepObject> readDeepObjects(Connection conn, String schema) throws SQLException
    {
        List<DeepObject> result = new ArrayList<>();
        try (PreparedStatement statement = conn.prepareStatement(SQL_DEEP_OBJECTS))
        {
            setSchemaFilter(statement, schema);
            try (ResultSet rs = statement.executeQuery())
            {
                while (rs.next())
                {
                    result.add(new DeepObject(rs.getLong("object_id"), rs.getString("schema_name"), rs.getString("object_name"), rs.getString("object_type")
                            .trim()));
                }
            }
        }
        return result;
    }

    private static Map<Long, List<JdbcSchemaObject>> readDeepColumns(Connection conn, String schema, String database) throws SQLException
    {
        Map<Long, List<JdbcSchemaObject>> result = new LinkedHashMap<>();
        try (PreparedStatement statement = conn.prepareStatement(SQL_DEEP_COLUMNS))
        {
            setSchemaFilter(statement, schema);
            try (ResultSet rs = statement.executeQuery())
            {
                while (rs.next())
                {
                    Map<String, Object> attrs = new LinkedHashMap<>();
                    String typeName = rs.getString("type_name");
                    attrs.put("type", typeName != null ? typeName.toLowerCase()
                            : "unknown");
                    attrs.put("nullable", rs.getBoolean("is_nullable") ? "YES"
                            : "NO");
                    putIfNotNull(attrs, "size", toNullableInteger(rs.getObject("max_length")));
                    putIfNotNull(attrs, "precision", toNullableInteger(rs.getObject("numeric_precision")));
                    putIfNotNull(attrs, "scale", toNullableInteger(rs.getObject("numeric_scale")));
                    applyKeyMetadata(rs, attrs);
                    long objectId = rs.getLong("object_id");
                    String objectName = rs.getString("object_name");
                    String schemaName = rs.getString("schema_name");
                    String columnName = rs.getString("column_name");
                    result.computeIfAbsent(objectId, _ -> new ArrayList<>())
                            .add(new JdbcSchemaObject(database + "." + schemaName + "." + objectName + "." + columnName, columnName, "column", null, Map.copyOf(attrs)));
                }
            }
        }
        return result;
    }

    private static Map<Long, List<JdbcSchemaObject>> readDeepIndexes(Connection conn, String schema, String database) throws SQLException
    {
        Map<IndexKey, DeepIndex> indexes = new LinkedHashMap<>();
        try (PreparedStatement statement = conn.prepareStatement(SQL_DEEP_INDEXES))
        {
            setSchemaFilter(statement, schema);
            try (ResultSet rs = statement.executeQuery())
            {
                while (rs.next())
                {
                    IndexKey key = new IndexKey(rs.getLong("object_id"), rs.getInt("index_id"));
                    DeepIndex index = indexes.get(key);
                    if (index == null)
                    {
                        index = new DeepIndex(rs.getString("schema_name"), rs.getString("object_name"), rs.getString("index_name"), rs.getBoolean("is_unique"), rs.getBoolean("is_primary_key"),
                                new ArrayList<>());
                        indexes.put(key, index);
                    }
                    String columnName = rs.getString("column_name");
                    Map<String, Object> attrs = new LinkedHashMap<>();
                    attrs.put("ordinal", rs.getShort("key_ordinal"));
                    attrs.put("sortOrder", rs.getBoolean("is_descending_key") ? "DESC"
                            : "ASC");
                    index.columns()
                            .add(new DeepIndexColumn(columnName, attrs));
                }
            }
        }
        Map<Long, List<JdbcSchemaObject>> result = new LinkedHashMap<>();
        for (Map.Entry<IndexKey, DeepIndex> entry : indexes.entrySet())
        {
            DeepIndex index = entry.getValue();
            String idPrefix = database + "." + index.schema() + "." + index.objectName();
            final List<JdbcSchemaObject> columnChildren = index.columns()
                    .stream()
                    .map(column -> new JdbcSchemaObject("index_col:" + idPrefix + ":" + index.name() + ":" + column.name(), column.name(), "index_column", null, Map.copyOf(column.attributes())))
                    .toList();
            Map<String, Object> attrs = new LinkedHashMap<>();
            attrs.put("columns", index.columns()
                    .stream()
                    .map(DeepIndexColumn::name)
                    .collect(java.util.stream.Collectors.joining(", ")));
            attrs.put("unique", index.unique());
            if (index.primaryKey())
            {
                attrs.put("primaryKey", true);
            }
            result.computeIfAbsent(entry.getKey()
                    .objectId(), _ -> new ArrayList<>())
                    .add(new JdbcSchemaObject("index:" + idPrefix + ":" + index.name(), index.name(), "index", columnChildren, Map.copyOf(attrs)));
        }
        return result;
    }

    private static List<JdbcSchemaObject> readDeepProcedures(Connection conn, String schema, String database) throws SQLException
    {
        Map<Long, DeepProcedure> procedures = new LinkedHashMap<>();
        try (PreparedStatement statement = conn.prepareStatement(SQL_DEEP_PROCEDURES))
        {
            setSchemaFilter(statement, schema);
            try (ResultSet rs = statement.executeQuery())
            {
                while (rs.next())
                {
                    long objectId = rs.getLong("object_id");
                    DeepProcedure procedure = procedures.get(objectId);
                    if (procedure == null)
                    {
                        procedure = new DeepProcedure(rs.getString("schema_name"), rs.getString("object_name"), new ArrayList<>());
                        procedures.put(objectId, procedure);
                    }
                    String parameterName = rs.getString("parameter_name");
                    if (parameterName != null)
                    {
                        String typeName = rs.getString("type_name");
                        Map<String, Object> attrs = new LinkedHashMap<>();
                        attrs.put("type", typeName != null ? typeName.toLowerCase()
                                : "unknown");
                        attrs.put("mode", rs.getBoolean("is_output") ? "OUT"
                                : "IN");
                        attrs.put("ordinal", rs.getInt("ordinal"));
                        procedure.parameters()
                                .add(new JdbcSchemaObject("param:" + objectId + ":" + parameterName, parameterName, "parameter", null, Map.copyOf(attrs)));
                    }
                }
            }
        }
        List<JdbcSchemaObject> result = new ArrayList<>();
        for (Map.Entry<Long, DeepProcedure> entry : procedures.entrySet())
        {
            DeepProcedure procedure = entry.getValue();
            result.add(new JdbcSchemaObject("procedure:" + database + "." + procedure.schema() + "." + procedure.name(), procedure.name(), "procedure", null,
                    procedure.schema() + "." + procedure.name(), List.copyOf(procedure.parameters()), objectAttributes(database, procedure.schema())));
        }
        return result;
    }

    private static void setSchemaFilter(PreparedStatement statement, String schema) throws SQLException
    {
        statement.setString(1, schema);
        statement.setString(2, schema);
    }

    private static Map<String, Object> objectAttributes(String database, String schema)
    {
        Map<String, Object> attrs = new LinkedHashMap<>();
        if (database != null)
        {
            attrs.put(KEY_CATALOG, database);
        }
        attrs.put(KEY_SCHEMA, schema);
        return Map.copyOf(attrs);
    }

    private static void putIfNotNull(Map<String, Object> attrs, String key, Object value)
    {
        if (value != null)
        {
            attrs.put(key, value);
        }
    }

    private static String key(String... values)
    {
        return java.util.Arrays.stream(values)
                .map(value -> value == null ? ""
                        : value)
                .collect(java.util.stream.Collectors.joining("|"));
    }

    private record DeepObject(long objectId, String schema, String name, String type)
    {
    }

    private record IndexKey(long objectId, int indexId)
    {
    }

    private record DeepIndex(String schema, String objectName, String name, boolean unique, boolean primaryKey, List<DeepIndexColumn> columns)
    {
    }

    private record DeepIndexColumn(String name, Map<String, Object> attributes)
    {
    }

    private record DeepProcedure(String schema, String name, List<JdbcSchemaObject> parameters)
    {
    }

    static void applyKeyMetadata(ResultSet rs, Map<String, Object> attrs) throws SQLException
    {
        if (rs.getBoolean("is_primary_key"))
        {
            attrs.put("primaryKey", true);
        }
        String referencedTable = rs.getString("referenced_table");
        if (referencedTable == null)
        {
            return;
        }
        attrs.put("foreignKey", true);
        String referencedSchema = rs.getString("referenced_schema");
        if (referencedSchema != null
                && !referencedSchema.isEmpty())
        {
            attrs.put("referencesSchema", referencedSchema);
        }
        attrs.put("referencesTable", referencedTable);
        String referencedColumn = rs.getString("referenced_column");
        if (referencedColumn != null)
        {
            attrs.put("referencesColumn", referencedColumn);
        }
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
