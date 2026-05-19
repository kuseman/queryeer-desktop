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
                .toAbsolutePath() + ";MODE=PostgreSQL;AUTO_SERVER=TRUE";

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
                    .toAbsolutePath() + ";MODE=PostgreSQL;AUTO_SERVER=TRUE";
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
                        with recursive db_tree(root_id, root_name, current_id) as
                        (
                          -- Anchor Member: Find all top-level databases
                          select object_id   as root_id
                          ,      object_name as root_name
                          ,      object_id   as current_id
                          from schema_object
                          where kind = 'database'
                          and is_deleted = false

                          union all

                          -- Recursive Member: Walk down the tree to find all children/descendants
                          select dt.root_id
                          ,      dt.root_name
                          ,      child.object_id as current_id
                          from schema_object child
                          join db_tree dt
                            on child.parent_object_id = dt.current_id
                          where child.is_deleted = false
                        )
                        -- Final Selection: Now group by the root_id we tracked
                        select root_id, count(*) as object_count
                        from db_tree
                        group by root_id
                        """); ResultSet resultSet = statement.executeQuery())
                {
                    while (resultSet.next())
                    {
                        String rootId = resultSet.getString(1);
                        int count = resultSet.getInt(2);
                        // Look up the database name from schema_object
                        try (PreparedStatement nameStmt = connection.prepareStatement("select object_name from schema_object where object_id = ?"))
                        {
                            nameStmt.setString(1, rootId);
                            try (ResultSet nameRs = nameStmt.executeQuery())
                            {
                                if (nameRs.next())
                                {
                                    objectCountByDatabase.put(nameRs.getString(1), count);
                                }
                            }
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

    private record CrawlStateWithTimestamps(int consecutiveFailures, double usageScore, boolean enabled, Instant nextDueAt, Instant lastSuccessAt, Instant lastAttemptAt, Instant lastFailureAt)
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
