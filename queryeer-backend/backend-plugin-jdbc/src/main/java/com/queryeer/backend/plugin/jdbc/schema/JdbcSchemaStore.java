package com.queryeer.backend.plugin.jdbc.schema;

import static com.queryeer.backend.api.PayloadUtils.getIfNull;

import java.io.EOFException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CancellationException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.plugin.jdbc.JdbcUtils;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;

public final class JdbcSchemaStore
{
    private static final String H2_DRIVER_CLASS_NAME = "org.h2.Driver";
    private static final long CONNECTION_TIMEOUT_MS = 10_000L;
    private static final long MAX_FILE_SIZE_BYTES = 100L * 1024L * 1024L;
    private static final Set<Path> CORRUPTED_FILES = ConcurrentHashMap.newKeySet();
    private final Path baseDir;
    private final PayloadMapper mapper;

    public JdbcSchemaStore(Path baseDir, PayloadMapper mapper)
    {
        this.baseDir = baseDir;
        this.mapper = mapper;
    }

    public void persistSnapshot(String connectionId, JdbcSchemaCrawlScope scope, List<JdbcSchemaObject> roots)
    {
        try (Connection connection = open(connectionId, scope))
        {
            connection.setAutoCommit(false);
            long runId = insertRun(connection);
            markAllDeleted(connection);
            clearReferences(connection);
            long[] ordinal = new long[] { 0L };
            long[] edgeOrdinal = new long[] { 0L };
            for (JdbcSchemaObject root : roots)
            {
                upsertObject(connection, runId, null, root, ordinal, edgeOrdinal);
            }
            rebuildSemanticReferences(connection, edgeOrdinal);
            finishRun(connection, runId, "SUCCESS", null);
            connection.commit();
        }
        catch (Exception e)
        {
            throw new RuntimeException("Failed to persist schema snapshot for connection " + connectionId, e);
        }
        // Compact after snapshot to prevent unbounded MVStore growth
        compactIfNeeded(connectionId, scope);
    }

    void persistDeepSnapshotTarget(String connectionId, String database, String schema, List<JdbcSchemaObject> fetched)
    {
        String db = normalizeTargetDatabase(database, fetched);
        if (db == null)
        {
            throw new IllegalArgumentException("database is required for targeted deep schema persistence");
        }

        try (Connection connection = open(connectionId, JdbcSchemaCrawlScope.DEEP))
        {
            connection.setAutoCommit(false);
            long runId = insertRun(connection);
            long[] ordinal = new long[] { maxOrdinal(connection) };
            long[] edgeOrdinal = new long[] { maxReferenceOrdinal(connection) };

            String databaseObjectId = findDatabaseObjectId(connection, db);
            if (schema == null
                    || schema.isBlank())
            {
                markTargetSubtreeDeleted(connection, databaseObjectId);
                upsertObject(connection, runId, null, databaseNode(db, fetched), ordinal, edgeOrdinal);
            }
            else
            {
                JdbcSchemaObject dbNode = new JdbcSchemaObject("database:" + db, db, "database", List.of(), Map.of());
                upsertObject(connection, runId, null, dbNode, ordinal, edgeOrdinal);
                databaseObjectId = dbNode.id();
                String schemaObjectId = findSchemaObjectId(connection, databaseObjectId, schema);
                markTargetSubtreeDeleted(connection, schemaObjectId);
                upsertObject(connection, runId, databaseObjectId, schemaNode(db, schema, fetched), ordinal, edgeOrdinal);
            }

            clearSemanticReferences(connection);
            rebuildSemanticReferences(connection, edgeOrdinal);
            finishRun(connection, runId, "SUCCESS", null);
            connection.commit();
        }
        catch (Exception e)
        {
            throw new RuntimeException("Failed to persist targeted schema snapshot for connection " + connectionId, e);
        }
        compactIfNeeded(connectionId, JdbcSchemaCrawlScope.DEEP);
    }

    public List<JdbcSchemaObject> latestSnapshot(String connectionId, JdbcSchemaCrawlScope scope)
    {
        try (Connection connection = open(connectionId, scope))
        {
            List<Row> rows = new ArrayList<>();
            String sql = """
                    select object_id, parent_object_id, object_name, kind, attributes_json, ordinal
                    from schema_object
                    where is_deleted = false
                    order by ordinal
                    """;
            try (PreparedStatement statement = connection.prepareStatement(sql); ResultSet resultSet = statement.executeQuery())
            {
                while (resultSet.next())
                {
                    rows.add(new Row(resultSet.getString(1), resultSet.getString(2), resultSet.getString(3), resultSet.getString(4), resultSet.getString(5)));
                }
            }
            return mapRows(rows);
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    boolean isDue(String connectionId, JdbcSchemaCrawlScope scope, Instant now)
    {
        CrawlState state = readState(connectionId, scope, null);
        return !now.isBefore(state.nextDueAt());
    }

    boolean isDue(String connectionId, JdbcSchemaCrawlScope scope, String databaseKey, Instant now)
    {
        CrawlState state = readState(connectionId, scope, databaseKey);
        return !now.isBefore(state.nextDueAt());
    }

    CrawlState readState(String connectionId, JdbcSchemaCrawlScope scope)
    {
        return readState(connectionId, scope, null);
    }

    CrawlState readState(String connectionId, JdbcSchemaCrawlScope scope, String databaseKey)
    {
        try (Connection connection = open(connectionId, scope))
        {
            String sql = """
                    select consecutive_failures, usage_score, enabled, next_due_at
                    from crawl_state
                    where state_id = 1
                    and database_key = ?
                    """;
            try (PreparedStatement statement = connection.prepareStatement(sql))
            {
                statement.setString(1, normalizeDatabaseKey(databaseKey));
                try (ResultSet resultSet = statement.executeQuery())
                {
                    if (!resultSet.next())
                    {
                        return initializeState(connection, normalizeDatabaseKey(databaseKey), Instant.now());
                    }
                    Instant nextDueAt = resultSet.getTimestamp(4) == null ? Instant.EPOCH
                            : resultSet.getTimestamp(4)
                                    .toInstant();
                    return new CrawlState(resultSet.getInt(1), resultSet.getDouble(2), resultSet.getBoolean(3), nextDueAt);
                }
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    void recordUsage(String connectionId, JdbcSchemaCrawlScope scope, Instant now)
    {
        recordUsage(connectionId, scope, null, now);
    }

    void recordUsage(String connectionId, JdbcSchemaCrawlScope scope, String databaseKey, Instant now)
    {
        try (Connection connection = open(connectionId, scope))
        {
            String normalized = normalizeDatabaseKey(databaseKey);
            CrawlState state = readState(connectionId, scope, normalized);
            Instant previousUse = readLastUsedAt(connection, normalized);
            double decayed = decay(state.usageScore(), previousUse, now);
            double nextScore = Math.min(1.0d, decayed + 0.30d);
            try (PreparedStatement statement = connection.prepareStatement("""
                    update crawl_state
                    set usage_score = ?
                    , last_attempt_at = ?
                    , last_used_at = ?
                    , next_due_at = coalesce(next_due_at, ?)
                    where state_id = 1
                    and database_key = ?
                    """))
            {
                statement.setDouble(1, nextScore);
                statement.setTimestamp(2, java.sql.Timestamp.from(now));
                statement.setTimestamp(3, java.sql.Timestamp.from(now));
                statement.setTimestamp(4, java.sql.Timestamp.from(Instant.EPOCH));
                statement.setString(5, normalized);
                statement.executeUpdate();
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    void updateState(String connectionId, JdbcSchemaCrawlScope scope, CrawlState state, Instant attemptedAt, Instant nextDueAt)
    {
        updateState(connectionId, scope, null, state, attemptedAt, nextDueAt);
    }

    void updateState(String connectionId, JdbcSchemaCrawlScope scope, String databaseKey, CrawlState state, Instant attemptedAt, Instant nextDueAt)
    {
        try (Connection connection = open(connectionId, scope))
        {
            String normalized = normalizeDatabaseKey(databaseKey);
            try (PreparedStatement statement = connection.prepareStatement("""
                    update crawl_state
                    set consecutive_failures = ?
                    , usage_score = ?
                    , enabled = ?
                    , last_attempt_at = ?
                    , last_success_at = ?
                    , last_failure_at = ?
                    , next_due_at = ?
                    where state_id = 1
                    and database_key = ?
                    """))
            {
                statement.setInt(1, state.consecutiveFailures());
                statement.setDouble(2, state.usageScore());
                statement.setBoolean(3, state.enabled());
                statement.setTimestamp(4, java.sql.Timestamp.from(attemptedAt));
                statement.setTimestamp(5, state.consecutiveFailures() == 0 ? java.sql.Timestamp.from(attemptedAt)
                        : null);
                statement.setTimestamp(6, state.consecutiveFailures() > 0 ? java.sql.Timestamp.from(attemptedAt)
                        : null);
                statement.setTimestamp(7, java.sql.Timestamp.from(nextDueAt));
                statement.setString(8, normalized);
                statement.executeUpdate();
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    private Connection open(String connectionId, JdbcSchemaCrawlScope scope) throws SQLException
    {
        ensureH2DriverLoaded();
        try
        {
            Files.createDirectories(baseDir);
        }
        catch (Exception e)
        {
            throw new RuntimeException(e);
        }
        String fileName = sanitize(connectionId + "__"
                                   + scope.name()
                                           .toLowerCase());
        Path dbPath = baseDir.resolve(fileName + ".mv.db");
        String url = "jdbc:h2:file:" + baseDir.resolve(fileName)
                .toAbsolutePath() + ";MODE=PostgreSQL";

        // If this file was previously detected as corrupted, delete it upfront
        if (CORRUPTED_FILES.remove(dbPath))
        {
            deleteDbFiles(dbPath);
        }

        // Prophylactic size limit: schema cache should never exceed ~100MB.
        // Overgrown files indicate MVStore bloat; delete and start fresh.
        if (isOvergrown(dbPath))
        {
            deleteDbFiles(dbPath);
        }

        try
        {
            Connection connection = connectWithTimeout(url, CONNECTION_TIMEOUT_MS);
            migrate(connection);
            return connection;
        }
        catch (Exception e)
        {
            if (isCorruptionError(e))
            {
                // Corruption detected — delete database files and retry once
                deleteDbFiles(dbPath);
                try
                {
                    Connection connection = connectWithTimeout(url, CONNECTION_TIMEOUT_MS);
                    migrate(connection);
                    return connection;
                }
                catch (Exception e2)
                {
                    CORRUPTED_FILES.add(dbPath);
                    throw new SQLException("Schema cache unrecoverable for " + connectionId + "/" + scope, e2);
                }
            }
            throw e;
        }
    }

    private static Connection connectWithTimeout(String url, long timeoutMs) throws SQLException
    {
        ClassLoader pluginCl = JdbcSchemaStore.class.getClassLoader();
        try
        {
            return CompletableFuture.supplyAsync(() ->
            {
                Thread thread = Thread.currentThread();
                ClassLoader previous = thread.getContextClassLoader();
                thread.setContextClassLoader(pluginCl);
                try
                {
                    return DriverManager.getConnection(url);
                }
                catch (SQLException e)
                {
                    throw new RuntimeException(e);
                }
                finally
                {
                    thread.setContextClassLoader(previous);
                }
            })
                    .get(timeoutMs, TimeUnit.MILLISECONDS);
        }
        catch (TimeoutException e)
        {
            throw new SQLException("Connection timeout opening H2 database (possible corruption): " + url, "90030", e);
        }
        catch (ExecutionException e)
        {
            if (e.getCause() instanceof SQLException sqle)
            {
                throw sqle;
            }
            throw new SQLException("Failed to open H2 database: " + url, e.getCause());
        }
        catch (InterruptedException | CancellationException e)
        {
            Thread.currentThread()
                    .interrupt();
            throw new SQLException("Interrupted while opening H2 database: " + url);
        }
    }

    private static void deleteDbFiles(Path dbPath)
    {
        try
        {
            Files.deleteIfExists(dbPath);
        }
        catch (Exception ignored)
        {
        }
        String name = dbPath.toString();
        if (name.endsWith(".mv.db"))
        {
            try
            {
                Files.deleteIfExists(Path.of(name.substring(0, name.length() - 6) + ".trace.db"));
            }
            catch (Exception ignored)
            {
            }
        }
    }

    private static boolean isOvergrown(Path dbPath)
    {
        try
        {
            return Files.size(dbPath) > MAX_FILE_SIZE_BYTES;
        }
        catch (Exception e)
        {
            return false;
        }
    }

    private void compactIfNeeded(String connectionId, JdbcSchemaCrawlScope scope)
    {
        try
        {
            String fileName = sanitize(connectionId + "__"
                                       + scope.name()
                                               .toLowerCase());
            Path dbPath = baseDir.resolve(fileName + ".mv.db");
            // Only compact if the file is large enough to matter (> 20 MB)
            if (!Files.exists(dbPath)
                    || Files.size(dbPath) < 20L * 1024L * 1024L)
            {
                return;
            }
            // Use the same URL parameters as open() to avoid metadata mismatches
            String url = "jdbc:h2:file:" + baseDir.resolve(fileName)
                    .toAbsolutePath() + ";MODE=PostgreSQL";
            try (Connection connection = DriverManager.getConnection(url); Statement statement = connection.createStatement())
            {
                statement.execute("SHUTDOWN COMPACT");
            }
        }
        catch (Exception ignored)
        {
        }
    }

    private static boolean isCorruptionError(Throwable e)
    {
        if (e == null)
        {
            return false;
        }
        String msg = e.getMessage();
        if (msg != null)
        {
            // H2 error codes related to file corruption / I/O errors
            if (msg.contains("[90028-") // IO Exception (Reading from file failed)
                    || msg.contains("[90030-") // File corrupted while reading record
                    || msg.contains("File corrupted while reading record")
                    || msg.contains("Reading from file"))
            {
                return true;
            }
            // MVStore corruption indicators
            if (msg.contains("Double mark")
                    || msg.contains("Chunk"))
            {
                return true;
            }
        }
        // EOFException at the root means a truncated/corrupted file
        if (e instanceof EOFException)
        {
            return true;
        }
        // TimeoutException means H2 hung on reading the file (corrupted or overgrown)
        if (e instanceof TimeoutException)
        {
            return true;
        }
        // Check root cause chain
        return isCorruptionError(e.getCause());
    }

    private static void ensureH2DriverLoaded()
    {
        try
        {
            Class.forName(H2_DRIVER_CLASS_NAME, true, JdbcSchemaStore.class.getClassLoader());
        }
        catch (ClassNotFoundException e)
        {
            throw new IllegalStateException("H2 JDBC driver is not available on classpath", e);
        }
    }

    private void migrate(Connection connection) throws SQLException
    {
        try (Statement statement = connection.createStatement())
        {
            statement.execute("""
                    create table if not exists crawl_run (
                      run_id bigint generated by default as identity primary key,
                      started_at timestamp not null,
                      finished_at timestamp,
                      status varchar(32) not null,
                      error_message clob
                    )
                    """);
            statement.execute("""
                    create table if not exists schema_object (
                      object_id varchar(600) primary key,
                      parent_object_id varchar(600),
                      object_name varchar(512) not null,
                      kind varchar(64) not null,
                      attributes_json clob,
                      ordinal bigint not null,
                      first_seen_run_id bigint not null,
                      last_seen_run_id bigint not null,
                      is_deleted boolean not null
                    )
                    """);
            statement.execute("""
                    create table if not exists object_reference (
                      reference_id bigint generated by default as identity primary key,
                      source_object_id varchar(600) not null,
                      target_object_id varchar(600),
                      reference_kind varchar(64) not null,
                      ordinal bigint not null,
                      attributes_json clob
                    )
                    """);
            statement.execute("""
                    create table if not exists crawl_state (
                      state_id int not null,
                      database_key varchar(512) not null default '',
                      last_success_at timestamp,
                      last_attempt_at timestamp,
                      last_used_at timestamp,
                      last_failure_at timestamp,
                      consecutive_failures int not null,
                      usage_score double not null,
                      enabled boolean not null,
                      next_due_at timestamp,
                      primary key(state_id, database_key)
                    )
                    """);
            statement.execute("create index if not exists idx_schema_object_deleted on schema_object(is_deleted)");
            statement.execute("create index if not exists idx_schema_object_deleted_ordinal on schema_object(is_deleted, ordinal)");
            statement.execute("create index if not exists idx_schema_object_parent_deleted on schema_object(parent_object_id, is_deleted)");
            statement.execute("create index if not exists idx_schema_object_kind_deleted_name on schema_object(kind, is_deleted, object_name)");
            statement.execute("create index if not exists idx_crawl_run_status_run_id on crawl_run(status, run_id)");
        }
    }

    private CrawlState initializeState(Connection connection, String databaseKey, Instant now) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into crawl_state(state_id, database_key, consecutive_failures, usage_score, enabled, next_due_at)
                select 1, ?, 0, 0.0, true, ?
                where not exists
                (
                    select 1
                    from crawl_state
                    where state_id = 1
                    and database_key = ?
                )
                """))
        {
            statement.setString(1, databaseKey);
            statement.setTimestamp(2, java.sql.Timestamp.from(now));
            statement.setString(3, databaseKey);
            try
            {
                statement.executeUpdate();
            }
            catch (SQLException e)
            {
                if (!"23505".equals(e.getSQLState()))
                {
                    throw e;
                }
            }
        }
        return new CrawlState(0, 0.0d, true, now);
    }

    private static long insertRun(Connection connection) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("insert into crawl_run(started_at, status) values (?, ?)", Statement.RETURN_GENERATED_KEYS))
        {
            statement.setTimestamp(1, java.sql.Timestamp.from(Instant.now()));
            statement.setString(2, "RUNNING");
            statement.executeUpdate();
            try (ResultSet keys = statement.getGeneratedKeys())
            {
                keys.next();
                return keys.getLong(1);
            }
        }
    }

    private static void finishRun(Connection connection, long runId, String status, String errorMessage) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("update crawl_run set finished_at = ?, status = ?, error_message = ? where run_id = ?"))
        {
            statement.setTimestamp(1, java.sql.Timestamp.from(Instant.now()));
            statement.setString(2, status);
            statement.setString(3, errorMessage);
            statement.setLong(4, runId);
            statement.executeUpdate();
        }
    }

    private static void markAllDeleted(Connection connection) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("update schema_object set is_deleted = true"))
        {
            statement.executeUpdate();
        }
    }

    private static void clearReferences(Connection connection) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("delete from object_reference"))
        {
            statement.executeUpdate();
        }
    }

    private static void clearSemanticReferences(Connection connection) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("delete from object_reference where reference_kind <> 'child'"))
        {
            statement.executeUpdate();
        }
    }

    private static long maxOrdinal(Connection connection) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("select coalesce(max(ordinal), 0) from schema_object"); ResultSet resultSet = statement.executeQuery())
        {
            resultSet.next();
            return resultSet.getLong(1);
        }
    }

    private static long maxReferenceOrdinal(Connection connection) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("select coalesce(max(ordinal), 0) from object_reference"); ResultSet resultSet = statement.executeQuery())
        {
            resultSet.next();
            return resultSet.getLong(1);
        }
    }

    private static String findDatabaseObjectId(Connection connection, String database) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("""
                select object_id
                from schema_object
                where parent_object_id is null
                and kind = 'database'
                and lower(object_name) = ?
                and is_deleted = false
                order by ordinal
                limit 1
                """))
        {
            statement.setString(1, database.toLowerCase());
            try (ResultSet resultSet = statement.executeQuery())
            {
                return resultSet.next() ? resultSet.getString(1)
                        : null;
            }
        }
    }

    private static String findSchemaObjectId(Connection connection, String databaseObjectId, String schema) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("""
                select object_id
                from schema_object
                where parent_object_id = ?
                and kind = 'schema'
                and lower(object_name) = ?
                and is_deleted = false
                order by ordinal
                limit 1
                """))
        {
            statement.setString(1, databaseObjectId);
            statement.setString(2, schema.toLowerCase());
            try (ResultSet resultSet = statement.executeQuery())
            {
                return resultSet.next() ? resultSet.getString(1)
                        : null;
            }
        }
    }

    private static void markTargetSubtreeDeleted(Connection connection, String rootObjectId) throws SQLException
    {
        if (rootObjectId == null)
        {
            return;
        }
        try (Statement statement = connection.createStatement())
        {
            statement.execute("create local temporary table if not exists targeted_schema_object_id(object_id varchar(600) primary key) not persistent");
            statement.execute("delete from targeted_schema_object_id");
        }
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into targeted_schema_object_id(object_id)
                with recursive subtree(object_id) as
                (
                  select object_id
                  from schema_object
                  where object_id = ?

                  union all

                  select child.object_id
                  from schema_object child
                  join subtree s
                    on child.parent_object_id = s.object_id
                  where child.is_deleted = false
                )
                select object_id
                from subtree
                """))
        {
            statement.setString(1, rootObjectId);
            statement.executeUpdate();
        }
        try (Statement statement = connection.createStatement())
        {
            statement.execute("""
                    delete from object_reference
                    where source_object_id in (select object_id from targeted_schema_object_id)
                    or target_object_id in (select object_id from targeted_schema_object_id)
                    """);
            statement.execute("""
                    update schema_object
                    set is_deleted = true
                    where object_id in (select object_id from targeted_schema_object_id)
                    """);
            statement.execute("delete from targeted_schema_object_id");
        }
    }

    private void upsertObject(Connection connection, long runId, String parentObjectId, JdbcSchemaObject object, long[] ordinal, long[] edgeOrdinal) throws Exception
    {
        String attributes = mapper.writeJson(object.attributes() == null ? Map.of()
                : object.attributes());
        String upsertSql = """
                merge into schema_object
                (
                    object_id
                ,   parent_object_id
                ,   object_name, kind
                ,   attributes_json, ordinal
                ,   first_seen_run_id
                ,   last_seen_run_id
                ,   is_deleted)
                values (?, ?, ?, ?, ?, ?,
                  coalesce((select first_seen_run_id from schema_object where object_id = ?), ?),
                  ?, false)
                """;
        try (PreparedStatement statement = connection.prepareStatement(upsertSql))
        {
            long nextOrdinal = ++ordinal[0];
            statement.setString(1, object.id());
            statement.setString(2, parentObjectId);
            statement.setString(3, object.name());
            statement.setString(4, object.kind());
            statement.setString(5, attributes);
            statement.setLong(6, nextOrdinal);
            statement.setString(7, object.id());
            statement.setLong(8, runId);
            statement.setLong(9, runId);
            statement.executeUpdate();
        }

        if (parentObjectId != null)
        {
            try (PreparedStatement edge = connection.prepareStatement("""
                    insert into object_reference(source_object_id, target_object_id, reference_kind, ordinal, attributes_json)
                    values (?, ?, ?, ?, ?)
                    """))
            {
                edge.setString(1, parentObjectId);
                edge.setString(2, object.id());
                edge.setString(3, "child");
                edge.setLong(4, ++edgeOrdinal[0]);
                edge.setString(5, null);
                edge.executeUpdate();
            }
        }

        if (object.children() == null)
        {
            return;
        }
        for (JdbcSchemaObject child : object.children())
        {
            upsertObject(connection, runId, object.id(), child, ordinal, edgeOrdinal);
        }
    }

    List<String> referenceKinds(String connectionId)
    {
        try (Connection connection = open(connectionId, JdbcSchemaCrawlScope.DEEP))
        {
            try (PreparedStatement statement = connection.prepareStatement("select reference_kind from object_reference order by ordinal"); ResultSet resultSet = statement.executeQuery())
            {
                List<String> result = new ArrayList<>();
                while (resultSet.next())
                {
                    result.add(resultSet.getString(1));
                }
                return result;
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    List<TableLookupEntry> entriesForCompletion(String connectionId, String selectedDatabase, List<String> kinds)
    {
        String normalizedSelectedDatabase = JdbcUtils.normalizeIdentifier(selectedDatabase);
        try (Connection connection = open(connectionId, JdbcSchemaCrawlScope.DEEP))
        {
            List<TableLookupEntry> result = new ArrayList<>();
            for (ObjectLookupEntry entry : objectLookupEntries(connection, kinds, null))
            {
                if (normalizedSelectedDatabase != null
                        && entry.database() != null
                        && !normalizedSelectedDatabase.equals(JdbcUtils.normalizeIdentifier(entry.database())))
                {
                    continue;
                }
                result.add(new TableLookupEntry(displayTableName(entry.schema(), entry.name()), normalizeTableKind(entry.kind()), entry.database(), entry.schema()));
            }
            return result;
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    Map<String, List<String>> columnNamesForTables(String connectionId, List<String> tableNames, String selectedDatabase)
    {
        Map<String, List<String>> result = new LinkedHashMap<>();
        if (tableNames == null
                || tableNames.isEmpty())
        {
            return result;
        }

        String normalizedSelectedDatabase = JdbcUtils.normalizeIdentifier(selectedDatabase);
        try (Connection connection = open(connectionId, JdbcSchemaCrawlScope.DEEP); PreparedStatement columnsStatement = connection.prepareStatement("""
                with recursive table_descendants(object_id, object_name, kind, ordinal) as
                (
                  select object_id, object_name, kind, ordinal
                  from schema_object
                  where object_id = ?
                  and is_deleted = false

                  union all

                  select child.object_id, child.object_name, child.kind, child.ordinal
                  from schema_object child
                  join table_descendants td
                    on child.parent_object_id = td.object_id
                  where child.is_deleted = false
                )
                select object_name
                from table_descendants
                where kind = 'column'
                order by ordinal
                """))
        {
            for (String tableName : tableNames)
            {
                TableLookup lookup = parseTableLookup(tableName);
                String normalizedDatabase = lookup.normalizedDatabase() != null ? lookup.normalizedDatabase()
                        : normalizedSelectedDatabase;
                ObjectLookupEntry table = firstMatchingObject(connection, lookup, normalizedDatabase, List.of("table", "view", "base table"));

                if (table == null)
                {
                    result.put(tableName, List.of());
                    continue;
                }

                columnsStatement.setString(1, table.objectId());
                try (ResultSet resultSet = columnsStatement.executeQuery())
                {
                    List<String> columns = new ArrayList<>();
                    while (resultSet.next())
                    {
                        String columnName = resultSet.getString(1);
                        if (columnName != null
                                && !columnName.isBlank())
                        {
                            columns.add(columnName);
                        }
                    }
                    result.put(tableName, columns);
                }
            }
            return result;
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    List<String> procedureParameterNames(String connectionId, String schemaName, String procedureName)
    {
        try (Connection connection = open(connectionId, JdbcSchemaCrawlScope.DEEP); PreparedStatement procStatement = connection.prepareStatement("""
                with recursive object_path(object_id, object_name, kind, schema_name, ordinal) as
                (
                  select object_id
                  ,      object_name
                  ,      kind
                  ,      case when kind = 'schema' then object_name else null end as schema_name
                  ,      ordinal
                  from schema_object
                  where parent_object_id is null
                  and is_deleted = false

                  union all

                  select child.object_id
                  ,      child.object_name
                  ,      child.kind
                  ,      case when child.kind = 'schema' then child.object_name else op.schema_name end as schema_name
                  ,      child.ordinal
                  from schema_object child
                  join object_path op
                    on child.parent_object_id = op.object_id
                  where child.is_deleted = false
                )
                select object_id
                from object_path
                where kind = 'procedure'
                and lower(object_name) = ?
                and (? is null or lower(schema_name) = ?)
                order by ordinal
                limit 1
                """); PreparedStatement paramsStatement = connection.prepareStatement("""
                select object_name, ordinal
                from schema_object
                where parent_object_id = ?
                and kind = 'parameter'
                and is_deleted = false
                order by ordinal
                """))
        {
            procStatement.setString(1, JdbcUtils.normalizeIdentifier(procedureName));
            String normalizedSchema = JdbcUtils.normalizeIdentifier(schemaName);
            procStatement.setString(2, normalizedSchema);
            procStatement.setString(3, normalizedSchema);
            String procObjectId;
            try (ResultSet resultSet = procStatement.executeQuery())
            {
                if (!resultSet.next())
                {
                    return List.of();
                }
                procObjectId = resultSet.getString(1);
            }
            paramsStatement.setString(1, procObjectId);
            try (ResultSet resultSet = paramsStatement.executeQuery())
            {
                List<String> params = new ArrayList<>();
                while (resultSet.next())
                {
                    String paramName = resultSet.getString(1);
                    if (paramName != null
                            && !paramName.isBlank())
                    {
                        params.add(paramName);
                    }
                }
                return params;
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    SymbolLookupEntry findSymbol(String connectionId, String rawToken, String selectedDatabase)
    {
        TableLookup lookup = parseTableLookup(rawToken);
        if (lookup.normalizedName() == null)
        {
            return null;
        }

        String normalizedSelectedDatabase = JdbcUtils.normalizeIdentifier(selectedDatabase);
        String normalizedDatabase = lookup.normalizedDatabase() != null ? lookup.normalizedDatabase()
                : normalizedSelectedDatabase;
        try (Connection connection = open(connectionId, JdbcSchemaCrawlScope.DEEP))
        {
            ObjectLookupEntry entry = firstMatchingObject(connection, lookup, normalizedDatabase, List.of("table", "view", "base table", "procedure"));
            if (entry == null)
            {
                return null;
            }
            String kind = normalizeTableKind(entry.kind());
            return new SymbolLookupEntry(kind, displayTableName(entry.schema(), entry.name()), displayFullTableName(entry.database(), entry.schema(), entry.name()), kind.toUpperCase(),
                    entry.database(), entry.schema(), entry.name());
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    ObjectDetail objectDetail(String connectionId, String rawToken, String selectedDatabase, List<String> kinds)
    {
        TableLookup lookup = parseTableLookup(rawToken);
        if (lookup.normalizedName() == null)
        {
            return null;
        }

        String normalizedSelectedDatabase = JdbcUtils.normalizeIdentifier(selectedDatabase);
        String normalizedDatabase = lookup.normalizedDatabase() != null ? lookup.normalizedDatabase()
                : normalizedSelectedDatabase;
        try (Connection connection = open(connectionId, JdbcSchemaCrawlScope.DEEP))
        {
            ObjectLookupEntry entry = firstMatchingObject(connection, lookup, normalizedDatabase, kinds);
            if (entry == null)
            {
                return null;
            }
            JdbcSchemaObject object = loadObjectTree(connection, entry.objectId());
            return object == null ? null
                    : new ObjectDetail(object, entry.database(), entry.schema());
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    ColumnDetail columnDetail(String connectionId, String columnName, String selectedDatabase)
    {
        String normalizedColumn = JdbcUtils.normalizeIdentifier(columnName);
        if (normalizedColumn == null)
        {
            return null;
        }
        String normalizedSelectedDatabase = JdbcUtils.normalizeIdentifier(selectedDatabase);
        try (Connection connection = open(connectionId, JdbcSchemaCrawlScope.DEEP); PreparedStatement statement = connection.prepareStatement("""
                select object_id, parent_object_id, object_name, attributes_json
                from schema_object
                where kind = 'column'
                and lower(object_name) = ?
                and is_deleted = false
                order by ordinal
                """))
        {
            statement.setString(1, normalizedColumn);
            try (ResultSet resultSet = statement.executeQuery())
            {
                while (resultSet.next())
                {
                    ColumnOwner owner = columnOwner(connection, resultSet.getString(2));
                    if (owner == null)
                    {
                        continue;
                    }
                    String database = owner.database();
                    if (normalizedSelectedDatabase != null
                            && database != null
                            && !normalizedSelectedDatabase.equals(JdbcUtils.normalizeIdentifier(database)))
                    {
                        continue;
                    }
                    @SuppressWarnings("unchecked")
                    Map<String, Object> attrs = getIfNull(mapper.parseJson(resultSet.getString(4), Map.class), Map.of());
                    JdbcSchemaObject column = new JdbcSchemaObject(resultSet.getString(1), resultSet.getString(3), "column", List.of(), attrs);
                    return new ColumnDetail(column, owner.tableName(), normalizeTableKind(owner.tableKind()), database, owner.schema());
                }
                return null;
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    private ObjectLookupEntry firstMatchingObject(Connection connection, TableLookup lookup, String normalizedDatabase, List<String> kinds) throws SQLException
    {
        for (ObjectLookupEntry entry : objectLookupEntries(connection, kinds, lookup.normalizedName()))
        {
            if (lookup.normalizedSchema() != null
                    && entry.schema() != null
                    && !lookup.normalizedSchema()
                            .equals(JdbcUtils.normalizeIdentifier(entry.schema())))
            {
                continue;
            }
            if (normalizedDatabase != null
                    && entry.database() != null
                    && !normalizedDatabase.equals(JdbcUtils.normalizeIdentifier(entry.database())))
            {
                continue;
            }
            return entry;
        }
        return null;
    }

    private List<ObjectLookupEntry> objectLookupEntries(Connection connection, List<String> kinds, String normalizedObjectName) throws SQLException
    {
        if (kinds == null
                || kinds.isEmpty())
        {
            return List.of();
        }
        String placeholders = kinds.stream()
                .map(_ -> "?")
                .collect(java.util.stream.Collectors.joining(","));
        String objectNamePredicate = normalizedObjectName == null ? ""
                : "and lower(object_name) = ?";
        String sql = """
                select object_id, parent_object_id, object_name, kind, attributes_json
                from schema_object
                where kind in (%s)
                and is_deleted = false
                %s
                order by ordinal
                """.formatted(placeholders, objectNamePredicate);
        try (PreparedStatement statement = connection.prepareStatement(sql))
        {
            int index = 1;
            for (String kind : kinds)
            {
                statement.setString(index++, kind);
            }
            if (normalizedObjectName != null)
            {
                statement.setString(index, normalizedObjectName);
            }
            try (ResultSet resultSet = statement.executeQuery())
            {
                List<ObjectLookupEntry> result = new ArrayList<>();
                while (resultSet.next())
                {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> attrs = getIfNull(mapper.parseJson(resultSet.getString(5), Map.class), Map.of());
                    ObjectPath path = objectPath(connection, resultSet.getString(2), attrs);
                    result.add(new ObjectLookupEntry(resultSet.getString(1), resultSet.getString(3), resultSet.getString(4), path.database(), path.schema()));
                }
                return result;
            }
        }
    }

    private ObjectPath objectPath(Connection connection, String parentObjectId, Map<String, Object> attributes) throws SQLException
    {
        String database = firstString(attributes.get("database"), attributes.get("catalog"));
        String schema = firstString(attributes.get("schema"));
        if ((database != null
                && schema != null)
                || parentObjectId == null)
        {
            return new ObjectPath(database, schema);
        }
        try (PreparedStatement statement = connection.prepareStatement("""
                select parent_object_id, object_name, kind, attributes_json
                from schema_object
                where object_id = ?
                and is_deleted = false
                """))
        {
            String currentParentObjectId = parentObjectId;
            while (currentParentObjectId != null
                    && (database == null
                            || schema == null))
            {
                statement.setString(1, currentParentObjectId);
                try (ResultSet resultSet = statement.executeQuery())
                {
                    if (!resultSet.next())
                    {
                        break;
                    }
                    @SuppressWarnings("unchecked")
                    Map<String, Object> parentAttrs = getIfNull(mapper.parseJson(resultSet.getString(4), Map.class), Map.of());
                    database = database != null ? database
                            : firstString(parentAttrs.get("database"), parentAttrs.get("catalog"));
                    schema = schema != null ? schema
                            : firstString(parentAttrs.get("schema"));
                    String kind = resultSet.getString(3);
                    if (database == null
                            && "database".equals(kind))
                    {
                        database = resultSet.getString(2);
                    }
                    else if (schema == null
                            && "schema".equals(kind))
                    {
                        schema = resultSet.getString(2);
                    }
                    currentParentObjectId = resultSet.getString(1);
                }
            }
            return new ObjectPath(database, schema);
        }
    }

    private ColumnOwner columnOwner(Connection connection, String parentObjectId) throws SQLException
    {
        if (parentObjectId == null)
        {
            return null;
        }
        try (PreparedStatement statement = connection.prepareStatement("""
                select object_id, parent_object_id, object_name, kind, attributes_json
                from schema_object
                where object_id = ?
                and is_deleted = false
                """))
        {
            String currentParentObjectId = parentObjectId;
            while (currentParentObjectId != null)
            {
                statement.setString(1, currentParentObjectId);
                try (ResultSet resultSet = statement.executeQuery())
                {
                    if (!resultSet.next())
                    {
                        return null;
                    }
                    String kind = resultSet.getString(4);
                    if ("table".equals(kind)
                            || "view".equals(kind)
                            || "base table".equals(kind))
                    {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> attrs = getIfNull(mapper.parseJson(resultSet.getString(5), Map.class), Map.of());
                        ObjectPath path = objectPath(connection, resultSet.getString(2), attrs);
                        return new ColumnOwner(resultSet.getString(3), kind, path.database(), path.schema());
                    }
                    currentParentObjectId = resultSet.getString(2);
                }
            }
            return null;
        }
    }

    private static String firstString(Object... values)
    {
        for (Object value : values)
        {
            String string = stringValue(value);
            if (string != null)
            {
                return string;
            }
        }
        return null;
    }

    private JdbcSchemaObject loadObjectTree(Connection connection, String objectId) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("""
                with recursive object_tree(object_id, parent_object_id, object_name, kind, attributes_json, ordinal) as
                (
                  select object_id
                  ,      cast(null as varchar(600))
                  ,      object_name
                  ,      kind
                  ,      attributes_json
                  ,      ordinal
                  from schema_object
                  where object_id = ?
                  and is_deleted = false

                  union all

                  select child.object_id
                  ,      child.parent_object_id
                  ,      child.object_name
                  ,      child.kind
                  ,      child.attributes_json
                  ,      child.ordinal
                  from schema_object child
                  join object_tree ot
                    on child.parent_object_id = ot.object_id
                  where child.is_deleted = false
                )
                select object_id, parent_object_id, object_name, kind, attributes_json
                from object_tree
                order by ordinal
                """))
        {
            statement.setString(1, objectId);
            try (ResultSet resultSet = statement.executeQuery())
            {
                List<Row> rows = new ArrayList<>();
                while (resultSet.next())
                {
                    rows.add(new Row(resultSet.getString(1), resultSet.getString(2), resultSet.getString(3), resultSet.getString(4), resultSet.getString(5)));
                }
                List<JdbcSchemaObject> roots = mapRows(rows);
                return roots.isEmpty() ? null
                        : roots.get(0);
            }
        }
    }

    private void rebuildSemanticReferences(Connection connection, long[] edgeOrdinal) throws SQLException
    {
        String sql = """
                select object_id
                ,      kind
                ,      attributes_json
                ,      parent_object_id
                from schema_object
                where is_deleted = false
                and kind in ('primary_key','foreign_key','index')
                """;
        try (PreparedStatement statement = connection.prepareStatement(sql); ResultSet resultSet = statement.executeQuery())
        {
            while (resultSet.next())
            {
                String objectId = resultSet.getString(1);
                String kind = resultSet.getString(2);
                String attributesJson = resultSet.getString(3);
                String parentObjectId = resultSet.getString(4);
                @SuppressWarnings("unchecked")
                Map<String, Object> attributes = getIfNull(mapper.parseJson(attributesJson, Map.class), Map.of());
                String columnName = stringValue(attributes.get("column"));
                if (columnName == null
                        || parentObjectId == null)
                {
                    continue;
                }

                String localColumnId = findColumnId(connection, parentObjectId, columnName);
                if (localColumnId != null)
                {
                    insertReference(connection, objectId, localColumnId, kind + "_column", ++edgeOrdinal[0], attributesJson);
                }

                if (!"foreign_key".equals(kind))
                {
                    continue;
                }

                String referencesTable = stringValue(attributes.get("referencesTable"));
                String referencesColumn = stringValue(attributes.get("referencesColumn"));
                if (referencesTable == null)
                {
                    continue;
                }
                String targetTableId = findTableIdByName(connection, referencesTable);
                if (targetTableId != null)
                {
                    insertReference(connection, objectId, targetTableId, "foreign_key_table", ++edgeOrdinal[0], attributesJson);
                    if (referencesColumn != null)
                    {
                        String targetColumnId = findColumnId(connection, targetTableId, referencesColumn);
                        if (targetColumnId != null)
                        {
                            insertReference(connection, objectId, targetColumnId, "foreign_key_column_ref", ++edgeOrdinal[0], attributesJson);
                        }
                    }
                }
            }
        }
    }

    private static void insertReference(Connection connection, String sourceObjectId, String targetObjectId, String referenceKind, long ordinal, String attributesJson) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into object_reference(source_object_id, target_object_id, reference_kind, ordinal, attributes_json)
                values (?, ?, ?, ?, ?)
                """))
        {
            statement.setString(1, sourceObjectId);
            statement.setString(2, targetObjectId);
            statement.setString(3, referenceKind);
            statement.setLong(4, ordinal);
            statement.setString(5, attributesJson);
            statement.executeUpdate();
        }
    }

    private static String findColumnId(Connection connection, String tableObjectId, String columnName) throws SQLException
    {
        String sql = """
                select object_id from schema_object
                where parent_object_id = ?
                and kind = 'column'
                and upper(object_name) = upper(?)
                and is_deleted = false
                """;
        try (PreparedStatement statement = connection.prepareStatement(sql))
        {
            statement.setString(1, tableObjectId);
            statement.setString(2, columnName);
            try (ResultSet resultSet = statement.executeQuery())
            {
                return resultSet.next() ? resultSet.getString(1)
                        : null;
            }
        }
    }

    private static String findTableIdByName(Connection connection, String tableName) throws SQLException
    {
        String sql = "select object_id from schema_object where kind in ('table','base table','view') and upper(object_name) = upper(?) and is_deleted = false";
        try (PreparedStatement statement = connection.prepareStatement(sql))
        {
            statement.setString(1, tableName);
            try (ResultSet resultSet = statement.executeQuery())
            {
                return resultSet.next() ? resultSet.getString(1)
                        : null;
            }
        }
    }

    private static Instant readLastUsedAt(Connection connection, String databaseKey) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("select last_used_at from crawl_state where state_id = 1 and database_key = ?"))
        {
            statement.setString(1, databaseKey);
            try (ResultSet resultSet = statement.executeQuery())
            {
                if (!resultSet.next())
                {
                    return null;
                }
                java.sql.Timestamp timestamp = resultSet.getTimestamp(1);
                return timestamp == null ? null
                        : timestamp.toInstant();
            }
        }
    }

    /** Returns all crawl status entries for a connection in a single pass per scope. */
    List<CrawlStatusEntry> crawlStatusForConnection(String connectionId, JdbcSchemaCrawlScope scope)
    {
        List<CrawlStatusEntry> result = new ArrayList<>();
        try (Connection connection = open(connectionId, scope))
        {
            // Read all crawl_state rows
            String stateSql = """
                    select database_key
                    ,      consecutive_failures
                    ,      usage_score, enabled
                    ,      next_due_at
                    ,      last_success_at
                    ,      last_attempt_at
                    ,      last_failure_at
                    from crawl_state
                    where state_id = 1
                    order by database_key
                    """;
            Map<String, CrawlStateWithTimestamps> stateMap = new LinkedHashMap<>();
            try (PreparedStatement statement = connection.prepareStatement(stateSql); ResultSet resultSet = statement.executeQuery())
            {
                while (resultSet.next())
                {
                    String dbKey = resultSet.getString(1);
                    Instant nextDueAt = resultSet.getTimestamp(5) == null ? Instant.EPOCH
                            : resultSet.getTimestamp(5)
                                    .toInstant();
                    Instant lastSuccessAt = resultSet.getTimestamp(6) != null ? resultSet.getTimestamp(6)
                            .toInstant()
                            : null;
                    Instant lastAttemptAt = resultSet.getTimestamp(7) != null ? resultSet.getTimestamp(7)
                            .toInstant()
                            : null;
                    Instant lastFailureAt = resultSet.getTimestamp(8) != null ? resultSet.getTimestamp(8)
                            .toInstant()
                            : null;
                    CrawlStateWithTimestamps state = new CrawlStateWithTimestamps(resultSet.getInt(2), resultSet.getDouble(3), resultSet.getBoolean(4), nextDueAt, lastSuccessAt, lastAttemptAt,
                            lastFailureAt);
                    stateMap.put(dbKey != null ? dbKey
                            : "", state);
                }
            }

            // Read last error message
            String lastError = null;
            try (PreparedStatement statement = connection.prepareStatement("select error_message from crawl_run where status = 'FAILED' order by run_id desc limit 1");
                    ResultSet resultSet = statement.executeQuery())
            {
                if (resultSet.next())
                {
                    lastError = resultSet.getString(1);
                }
            }

            // Compute per-database object counts for DEEP scope using recursive CTE
            Map<String, Integer> objectCountByDatabase = new HashMap<>();
            if (scope == JdbcSchemaCrawlScope.DEEP)
            {
                // Use recursive CTE to attribute each object to its root database
                try (PreparedStatement statement = connection.prepareStatement("""
                        with recursive db_tree(root_name, current_id) as
                        (
                          -- Anchor Member: Find all top-level databases
                          select object_name as root_name
                          ,      object_id   as current_id
                          from schema_object
                          where kind = 'database'
                          and is_deleted = false

                          union all

                          -- Recursive Member: Walk down the tree to find all children/descendants
                          select dt.root_name
                          ,      child.object_id as current_id
                          from schema_object child
                          join db_tree dt
                            on child.parent_object_id = dt.current_id
                          where child.is_deleted = false
                        )
                        -- Final Selection: Now group by the root database we tracked
                        select root_name, count(*) as object_count
                        from db_tree
                        group by root_name
                        """); ResultSet resultSet = statement.executeQuery())
                {
                    while (resultSet.next())
                    {
                        String databaseKey = resultSet.getString(1);
                        int count = resultSet.getInt(2);
                        if (databaseKey != null
                                && !databaseKey.isBlank())
                        {
                            objectCountByDatabase.put(databaseKey, count);
                        }
                    }
                }
            }
            else
            {
                // For TOP scope, just count all objects
                try (PreparedStatement statement = connection.prepareStatement("select count(*) from schema_object where is_deleted = false"); ResultSet resultSet = statement.executeQuery())
                {
                    if (resultSet.next())
                    {
                        objectCountByDatabase.put("", resultSet.getInt(1));
                    }
                }
            }

            // Build status entries — skip empty database_key for DEEP scope
            for (Map.Entry<String, CrawlStateWithTimestamps> entry : stateMap.entrySet())
            {
                String dbKey = entry.getKey();

                // For DEEP scope, skip the default empty-key entry (it's not a real database)
                if (scope == JdbcSchemaCrawlScope.DEEP
                        && dbKey.isBlank())
                {
                    continue;
                }

                CrawlStateWithTimestamps state = entry.getValue();
                int objectCount = objectCountByDatabase.getOrDefault(dbKey, 0);
                result.add(new CrawlStatusEntry(dbKey.isBlank() ? null
                        : dbKey, state.consecutiveFailures(), state.usageScore(), state.enabled(), state.nextDueAt(), state.lastSuccessAt(), state.lastAttemptAt(), state.lastFailureAt(), objectCount,
                        lastError));
            }

            // If no crawl_state rows exist (or all filtered), return a single entry with defaults for TOP scope
            if (result.isEmpty()
                    && scope == JdbcSchemaCrawlScope.TOP)
            {
                Instant now = Instant.now();
                int totalCount = objectCountByDatabase.getOrDefault("", 0);
                result.add(new CrawlStatusEntry(null, 0, 0.0d, true, now, null, null, null, totalCount, lastError));
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
        return result;
    }

    record CrawlStatusEntry(String databaseKey, int consecutiveFailures, double usageScore, boolean enabled, Instant nextDueAt, Instant lastSuccessAt, Instant lastAttemptAt, Instant lastFailureAt,
            int objectCount, String lastError)
    {
    }

    record TableLookupEntry(String name, String kind, String database, String schema)
    {
    }

    record SymbolLookupEntry(String kind, String name, String fullName, String detail, String database, String schema, String objectName)
    {
    }

    record ObjectDetail(JdbcSchemaObject object, String database, String schema)
    {
    }

    record ColumnDetail(JdbcSchemaObject column, String tableName, String tableKind, String database, String schema)
    {
    }

    private record ObjectLookupEntry(String objectId, String name, String kind, String database, String schema)
    {
    }

    private record ObjectPath(String database, String schema)
    {
    }

    private record ColumnOwner(String tableName, String tableKind, String database, String schema)
    {
    }

    private record CrawlStateWithTimestamps(int consecutiveFailures, double usageScore, boolean enabled, Instant nextDueAt, Instant lastSuccessAt, Instant lastAttemptAt, Instant lastFailureAt)
    {
    }

    private record TableLookup(String normalizedDatabase, String normalizedSchema, String normalizedName)
    {
    }

    List<String> databaseKeys(String connectionId, JdbcSchemaCrawlScope scope)
    {
        try (Connection connection = open(connectionId, scope);
                PreparedStatement statement = connection.prepareStatement("select database_key from crawl_state where state_id = 1 and database_key <> '' order by database_key");
                ResultSet resultSet = statement.executeQuery())
        {
            List<String> result = new ArrayList<>();
            while (resultSet.next())
            {
                String value = resultSet.getString(1);
                if (value != null
                        && !value.isBlank())
                {
                    result.add(value);
                }
            }
            return result;
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    private static String normalizeDatabaseKey(String databaseKey)
    {
        return databaseKey == null ? ""
                : databaseKey.trim();
    }

    private static String normalizeTargetDatabase(String database, List<JdbcSchemaObject> fetched)
    {
        if (database != null
                && !database.isBlank())
        {
            return database.trim();
        }
        for (JdbcSchemaObject object : fetched)
        {
            String catalog = stringValue(object.attributes() == null ? null
                    : object.attributes()
                            .get("catalog"));
            if (catalog != null)
            {
                return catalog;
            }
        }
        return null;
    }

    private static JdbcSchemaObject databaseNode(String database, List<JdbcSchemaObject> fetched)
    {
        Map<String, List<JdbcSchemaObject>> bySchema = new LinkedHashMap<>();
        for (JdbcSchemaObject object : fetched)
        {
            bySchema.computeIfAbsent(schemaName(object), _ -> new ArrayList<>())
                    .add(object);
        }
        List<JdbcSchemaObject> schemas = new ArrayList<>();
        for (Map.Entry<String, List<JdbcSchemaObject>> entry : bySchema.entrySet())
        {
            schemas.add(schemaNode(database, entry.getKey(), entry.getValue()));
        }
        return new JdbcSchemaObject("database:" + database, database, "database", List.copyOf(schemas), Map.of());
    }

    private static JdbcSchemaObject schemaNode(String database, String schema, List<JdbcSchemaObject> children)
    {
        return new JdbcSchemaObject(database + "." + schema, schema, "schema", List.copyOf(children), Map.of("catalog", database));
    }

    private static String schemaName(JdbcSchemaObject object)
    {
        String schema = stringValue(object.attributes() == null ? null
                : object.attributes()
                        .get("schema"));
        return schema != null ? schema
                : "public";
    }

    private static TableLookup parseTableLookup(String value)
    {
        String normalized = JdbcUtils.normalizeIdentifier(value);
        if (normalized == null)
        {
            return new TableLookup(null, null, null);
        }
        String[] parts = normalized.split("\\.");
        if (parts.length >= 3)
        {
            return new TableLookup(parts[parts.length - 3], parts[parts.length - 2], parts[parts.length - 1]);
        }
        if (parts.length == 2)
        {
            return new TableLookup(null, parts[0], parts[1]);
        }
        return new TableLookup(null, null, parts[0]);
    }

    private static String displayTableName(String schema, String name)
    {
        if (name == null)
        {
            return null;
        }
        return schema == null
                || schema.isBlank() ? name
                        : schema + "." + name;
    }

    private static String displayFullTableName(String database, String schema, String name)
    {
        String displayName = displayTableName(schema, name);
        if (displayName == null)
        {
            return null;
        }
        return database == null
                || database.isBlank() ? displayName
                        : database + "." + displayName;
    }

    private static String normalizeTableKind(String kind)
    {
        if (kind == null)
        {
            return "table";
        }
        if ("view".equalsIgnoreCase(kind))
        {
            return "view";
        }
        if ("procedure".equalsIgnoreCase(kind))
        {
            return "procedure";
        }
        return "table";
    }

    private static double decay(double currentScore, Instant previousUse, Instant now)
    {
        if (previousUse == null)
        {
            return currentScore;
        }
        double halfLifeMs = 7d * 24d * 60d * 60d * 1000d;
        double elapsedMs = Math.max(0d, now.toEpochMilli() - previousUse.toEpochMilli());
        return currentScore * Math.pow(0.5d, elapsedMs / halfLifeMs);
    }

    private static String stringValue(Object value)
    {
        if (!(value instanceof String stringValue))
        {
            return null;
        }
        String trimmed = stringValue.trim();
        return trimmed.isBlank() ? null
                : trimmed;
    }

    private List<JdbcSchemaObject> mapRows(List<Row> rows)
    {
        Map<String, List<JdbcSchemaObject>> byParent = new LinkedHashMap<>();
        Map<String, JdbcSchemaObject> byId = new LinkedHashMap<>();
        for (Row row : rows)
        {
            @SuppressWarnings("unchecked")
            Map<String, Object> attrs = getIfNull(mapper.parseJson(row.attributesJson(), Map.class), Map.of());
            JdbcSchemaObject object = new JdbcSchemaObject(row.objectId(), row.name(), row.kind(), new ArrayList<>(), attrs);
            byId.put(row.objectId(), object);
            byParent.computeIfAbsent(row.parentObjectId(), _ -> new ArrayList<>())
                    .add(object);
        }
        for (Row row : rows)
        {
            JdbcSchemaObject parent = byId.get(row.objectId());
            List<JdbcSchemaObject> children = byParent.get(row.objectId());
            if (children != null)
            {
                parent.children()
                        .addAll(children);
            }
        }
        return byParent.getOrDefault(null, List.of());
    }

    private static String sanitize(String value)
    {
        return value.replaceAll("[^a-zA-Z0-9._-]", "_");
    }

    private record Row(String objectId, String parentObjectId, String name, String kind, String attributesJson)
    {
    }

    record CrawlState(int consecutiveFailures, double usageScore, boolean enabled, Instant nextDueAt)
    {
        CrawlState onSuccess()
        {
            return new CrawlState(0, usageScore, enabled, nextDueAt);
        }

        CrawlState onFailure()
        {
            return new CrawlState(consecutiveFailures + 1, usageScore, enabled, nextDueAt);
        }
    }
}
