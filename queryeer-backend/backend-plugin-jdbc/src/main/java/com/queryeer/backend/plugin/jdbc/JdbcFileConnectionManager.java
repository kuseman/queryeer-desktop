package com.queryeer.backend.plugin.jdbc;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;

final class JdbcFileConnectionManager
{
    private static final long DEFAULT_IDLE_TIMEOUT_MS = TimeUnit.MINUTES.toMillis(30);
    private static final long DEFAULT_DEAD_SNAPSHOT_TTL_MS = TimeUnit.SECONDS.toMillis(45);
    private final Map<String, FileSessionHandle> byFileId = new ConcurrentHashMap<>();
    private final Map<String, DeadSessionSnapshot> deadByFileId = new ConcurrentHashMap<>();
    private final long idleTimeoutMs;
    private final long deadSnapshotTtlMs;

    JdbcFileConnectionManager()
    {
        this(DEFAULT_IDLE_TIMEOUT_MS, DEFAULT_DEAD_SNAPSHOT_TTL_MS);
    }

    JdbcFileConnectionManager(long idleTimeoutMs)
    {
        this(idleTimeoutMs, DEFAULT_DEAD_SNAPSHOT_TTL_MS);
    }

    JdbcFileConnectionManager(long idleTimeoutMs, long deadSnapshotTtlMs)
    {
        this.idleTimeoutMs = Math.max(0L, idleTimeoutMs);
        this.deadSnapshotTtlMs = Math.max(0L, deadSnapshotTtlMs);
    }

    Connection acquire(String fileId, JdbcConnectionProfile profile, JdbcDialect dialect) throws SQLException
    {
        return acquireWithStatus(fileId, profile, dialect).connection();
    }

    AcquiredConnection acquireWithStatus(String fileId, JdbcConnectionProfile profile, JdbcDialect dialect) throws SQLException
    {
        long now = System.currentTimeMillis();
        java.util.concurrent.atomic.AtomicBoolean createdNew = new java.util.concurrent.atomic.AtomicBoolean(false);
        FileSessionHandle session = byFileId.compute(fileId, (id, existing) ->
        {
            if (existing != null
                    && existing.matches(profile))
            {
                try
                {
                    if (!existing.connection()
                            .isClosed())
                    {
                        return existing.touch(now);
                    }
                }
                catch (SQLException e)
                {
                    closeQuietly(existing.connection());
                }
            }

            if (existing != null)
            {
                rollbackAndClose(existing.connection());
            }

            Connection connection = openConnection(profile, dialect);
            createdNew.set(true);
            deadByFileId.remove(fileId);
            return new FileSessionHandle(profile.connectionId(), profile.dialectId(), text(profile.properties(), "url"), text(profile.properties(), "username"), text(profile.properties(), "password"),
                    connection, now, null);
        });

        return new AcquiredConnection(session.connection(), createdNew.get());
    }

    void closeFile(String fileId)
    {
        FileSessionHandle removed = byFileId.remove(fileId);
        if (removed != null)
        {
            rollbackAndClose(removed.connection());
            deadByFileId.put(fileId, new DeadSessionSnapshot(fileId, removed.connectionId(), removed.sessionId(), System.currentTimeMillis() + deadSnapshotTtlMs));
        }
    }

    void closeIdleConnections(long now)
    {
        if (idleTimeoutMs <= 0L)
        {
            return;
        }
        byFileId.forEach((fileId, session) ->
        {
            if (now - session.lastUsedAtMs() < idleTimeoutMs)
            {
                return;
            }
            if (byFileId.remove(fileId, session))
            {
                rollbackAndClose(session.connection());
                deadByFileId.put(fileId, new DeadSessionSnapshot(fileId, session.connectionId(), session.sessionId(), now + deadSnapshotTtlMs));
            }
        });
        if (deadSnapshotTtlMs > 0L)
        {
            deadByFileId.forEach((fileId, snapshot) ->
            {
                if (snapshot.expiresAtMs() <= now)
                {
                    deadByFileId.remove(fileId, snapshot);
                }
            });
        }
    }

    String resolveSessionId(String fileId, JdbcConnectionProfile profile, JdbcResolvedConnection resolved, String currentSessionId) throws SQLException
    {
        AcquiredConnection acquired = acquireWithStatus(fileId, profile, resolved.dialect());
        if (!acquired.createdNew()
                && currentSessionId != null
                && !currentSessionId.isBlank())
        {
            return currentSessionId;
        }
        Connection connection = acquired.connection();
        return resolved.dialect()
                .resolveSessionId(connection);
    }

    List<Map<String, Object>> connectionSnapshots(long now)
    {
        List<Map<String, Object>> result = new ArrayList<>();
        byFileId.forEach((fileId, session) ->
        {
            result.add(Map.of("fileId", fileId, "connectionId", session.connectionId(), "sessionId", session.sessionId() == null ? ""
                    : session.sessionId(), "lastAccessTimeMs", session.lastUsedAtMs(), "status", "alive"));
        });
        deadByFileId.forEach((fileId, snapshot) ->
        {
            if (snapshot.expiresAtMs() > now)
            {
                result.add(Map.of("fileId", fileId, "connectionId", snapshot.connectionId(), "sessionId", snapshot.sessionId() == null ? ""
                        : snapshot.sessionId(), "status", "dead"));
            }
        });
        return result;
    }

    private static Connection openConnection(JdbcConnectionProfile profile, JdbcDialect dialect)
    {
        try
        {
            return dialect.openSessionConnection(profile);
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    private static void rollbackAndClose(Connection connection)
    {
        try
        {
            if (!connection.getAutoCommit())
            {
                connection.rollback();
            }
        }
        catch (SQLException ignored)
        {
        }
        finally
        {
            closeQuietly(connection);
        }
    }

    private static void closeQuietly(Connection connection)
    {
        try
        {
            connection.close();
        }
        catch (SQLException ignored)
        {
        }
    }

    private static String text(Map<String, Object> properties, String key)
    {
        Object value = properties.get(key);
        if (value instanceof String s)
        {
            String trimmed = s.trim();
            return trimmed.isEmpty() ? null
                    : trimmed;
        }
        return null;
    }

    private record FileSessionHandle(String connectionId, String dialectId, String url, String username, String password, Connection connection, long lastUsedAtMs, String sessionId)
    {
        FileSessionHandle touch(long now)
        {
            return new FileSessionHandle(connectionId, dialectId, url, username, password, connection, now, sessionId);
        }

        boolean matches(JdbcConnectionProfile profile)
        {
            Map<String, Object> props = profile.properties();
            return Objects.equals(connectionId, profile.connectionId())
                    && Objects.equals(dialectId, profile.dialectId())
                    && Objects.equals(url, text(props, "url"))
                    && Objects.equals(username, text(props, "username"))
                    && Objects.equals(password, text(props, "password"));
        }

        FileSessionHandle withSessionId(String nextSessionId)
        {
            return new FileSessionHandle(connectionId, dialectId, url, username, password, connection, lastUsedAtMs, nextSessionId);
        }
    }

    void rememberSessionId(String fileId, String sessionId)
    {
        if (sessionId == null
                || sessionId.isBlank())
        {
            return;
        }
        byFileId.computeIfPresent(fileId, (ignored, existing) -> existing.withSessionId(sessionId));
    }

    private record DeadSessionSnapshot(String fileId, String connectionId, String sessionId, long expiresAtMs)
    {
    }

    record AcquiredConnection(Connection connection, boolean createdNew)
    {
    }
}
