package com.queryeer.backend.plugin.jdbc;

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
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject;

final class JdbcSchemaStore
{
    private static final String H2_DRIVER_CLASS_NAME = "org.h2.Driver";
    private final Path baseDir;
    private final ObjectMapper objectMapper;

    JdbcSchemaStore(Path baseDir)
    {
        this(baseDir, new ObjectMapper());
    }

    JdbcSchemaStore(Path baseDir, ObjectMapper objectMapper)
    {
        this.baseDir = baseDir;
        this.objectMapper = objectMapper;
    }

    void persistSnapshot(String connectionId, JdbcSchemaCrawlScope scope, List<JdbcSchemaObject> roots)
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
    }

    List<JdbcSchemaObject> latestSnapshot(String connectionId, JdbcSchemaCrawlScope scope)
    {
        try (Connection connection = open(connectionId, scope))
        {
            List<Row> rows = new ArrayList<>();
            String sql = "select object_id, parent_object_id, object_name, kind, attributes_json, ordinal from schema_object where is_deleted = false order by ordinal";
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
        CrawlState state = readState(connectionId, scope);
        return !now.isBefore(state.nextDueAt());
    }

    CrawlState readState(String connectionId, JdbcSchemaCrawlScope scope)
    {
        try (Connection connection = open(connectionId, scope))
        {
            String sql = "select consecutive_failures, usage_score, enabled, next_due_at from crawl_state where state_id = 1";
            try (PreparedStatement statement = connection.prepareStatement(sql); ResultSet resultSet = statement.executeQuery())
            {
                if (!resultSet.next())
                {
                    return initializeState(connection, Instant.now());
                }
                Instant nextDueAt = resultSet.getTimestamp(4) == null ? Instant.EPOCH
                        : resultSet.getTimestamp(4)
                                .toInstant();
                return new CrawlState(resultSet.getInt(1), resultSet.getDouble(2), resultSet.getBoolean(3), nextDueAt);
            }
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    void recordUsage(String connectionId, JdbcSchemaCrawlScope scope, Instant now)
    {
        try (Connection connection = open(connectionId, scope))
        {
            CrawlState state = readState(connectionId, scope);
            Instant previousUse = readLastUsedAt(connection);
            double decayed = decay(state.usageScore(), previousUse, now);
            double nextScore = Math.min(1.0d, decayed + 0.30d);
            try (PreparedStatement statement = connection
                    .prepareStatement("update crawl_state set usage_score = ?, last_attempt_at = ?, last_used_at = ?, next_due_at = coalesce(next_due_at, ?) where state_id = 1"))
            {
                statement.setDouble(1, nextScore);
                statement.setTimestamp(2, java.sql.Timestamp.from(now));
                statement.setTimestamp(3, java.sql.Timestamp.from(now));
                statement.setTimestamp(4, java.sql.Timestamp.from(Instant.EPOCH));
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
        try (Connection connection = open(connectionId, scope))
        {
            try (PreparedStatement statement = connection.prepareStatement(
                    "update crawl_state set consecutive_failures = ?, usage_score = ?, enabled = ?, last_attempt_at = ?, last_success_at = ?, last_failure_at = ?, next_due_at = ? where state_id = 1"))
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
        String url = "jdbc:h2:file:" + baseDir.resolve(fileName)
                .toAbsolutePath() + ";MODE=PostgreSQL;AUTO_SERVER=TRUE";
        Connection connection = DriverManager.getConnection(url);
        migrate(connection);
        return connection;
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
                      state_id int primary key,
                      last_success_at timestamp,
                      last_attempt_at timestamp,
                      last_used_at timestamp,
                      last_failure_at timestamp,
                      consecutive_failures int not null,
                      usage_score double not null,
                      enabled boolean not null,
                      next_due_at timestamp
                    )
                    """);
            statement.execute("alter table crawl_state add column if not exists last_used_at timestamp");
        }
    }

    private CrawlState initializeState(Connection connection, Instant now) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement(
                "insert into crawl_state(state_id, consecutive_failures, usage_score, enabled, next_due_at) select 1, 0, 0.0, true, ? where not exists (select 1 from crawl_state where state_id = 1)"))
        {
            statement.setTimestamp(1, java.sql.Timestamp.from(now));
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
        String attributes = objectMapper.writeValueAsString(object.attributes() == null ? Map.of()
                : object.attributes());
        String upsertSql = """
                merge into schema_object (object_id, parent_object_id, object_name, kind, attributes_json, ordinal, first_seen_run_id, last_seen_run_id, is_deleted)
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
            try (PreparedStatement edge = connection
                    .prepareStatement("insert into object_reference(source_object_id, target_object_id, reference_kind, ordinal, attributes_json) values (?, ?, ?, ?, ?)"))
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
        String sql = "select object_id, kind, attributes_json, parent_object_id from schema_object where is_deleted = false and kind in ('primary_key','foreign_key','index')";
        try (PreparedStatement statement = connection.prepareStatement(sql); ResultSet resultSet = statement.executeQuery())
        {
            while (resultSet.next())
            {
                String objectId = resultSet.getString(1);
                String kind = resultSet.getString(2);
                String attributesJson = resultSet.getString(3);
                String parentObjectId = resultSet.getString(4);
                Map<String, Object> attributes = parseAttributes(attributesJson);
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
        try (PreparedStatement statement = connection
                .prepareStatement("insert into object_reference(source_object_id, target_object_id, reference_kind, ordinal, attributes_json) values (?, ?, ?, ?, ?)"))
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
        String sql = "select object_id from schema_object where parent_object_id = ? and kind = 'column' and upper(object_name) = upper(?) and is_deleted = false";
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

    private static Instant readLastUsedAt(Connection connection) throws SQLException
    {
        try (PreparedStatement statement = connection.prepareStatement("select last_used_at from crawl_state where state_id = 1"); ResultSet resultSet = statement.executeQuery())
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
        Map<String, List<JdbcSchemaObject>> byParent = new java.util.LinkedHashMap<>();
        Map<String, JdbcSchemaObject> byId = new java.util.LinkedHashMap<>();
        for (Row row : rows)
        {
            Map<String, Object> attrs = parseAttributes(row.attributesJson());
            JdbcSchemaObject object = new JdbcSchemaObject(row.objectId(), row.name(), row.kind(), new ArrayList<>(), attrs);
            byId.put(row.objectId(), object);
            byParent.computeIfAbsent(row.parentObjectId(), k -> new ArrayList<>())
                    .add(object);
        }
        for (Row row : rows)
        {
            JdbcSchemaObject parent = byId.get(row.objectId());
            List<JdbcSchemaObject> children = byParent.get(row.objectId());
            if (children != null)
            {
                ((List<JdbcSchemaObject>) parent.children()).addAll(children);
            }
        }
        return byParent.getOrDefault(null, List.of());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> parseAttributes(String json)
    {
        if (json == null
                || json.isBlank())
        {
            return Map.of();
        }
        try
        {
            return objectMapper.readValue(json, Map.class);
        }
        catch (Exception e)
        {
            return Map.of();
        }
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
