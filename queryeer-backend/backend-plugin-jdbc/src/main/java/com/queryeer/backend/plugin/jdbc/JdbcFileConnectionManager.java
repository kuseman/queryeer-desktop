package com.queryeer.backend.plugin.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

final class JdbcFileConnectionManager
{
    private static final long DEFAULT_IDLE_TIMEOUT_MS = TimeUnit.MINUTES.toMillis(30);
    private final Map<String, FileConnectionSession> byFileId = new ConcurrentHashMap<>();
    private final long idleTimeoutMs;

    JdbcFileConnectionManager()
    {
        this(DEFAULT_IDLE_TIMEOUT_MS);
    }

    JdbcFileConnectionManager(long idleTimeoutMs)
    {
        this.idleTimeoutMs = Math.max(0L, idleTimeoutMs);
    }

    Connection acquire(String fileId, JdbcExecutionState state) throws SQLException
    {
        long now = System.currentTimeMillis();
        FileConnectionSession session = byFileId.compute(fileId, (id, existing) ->
        {
            if (existing != null
                    && existing.matches(state))
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

            Connection connection = openConnection(state);
            return new FileConnectionSession(state.connectionId(), state.dialectId(), state.url(), state.username(), state.resolvedPassword(), connection, now);
        });

        return session.connection();
    }

    void closeFile(String fileId)
    {
        FileConnectionSession removed = byFileId.remove(fileId);
        if (removed != null)
        {
            rollbackAndClose(removed.connection());
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
            }
        });
    }

    private static Connection openConnection(JdbcExecutionState state)
    {
        try
        {
            Properties properties = new Properties();
            if (state.username() != null)
            {
                properties.setProperty("user", state.username());
            }
            if (state.resolvedPassword() != null)
            {
                properties.setProperty("password", state.resolvedPassword());
            }
            return DriverManager.getConnection(state.url(), properties);
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

    private record FileConnectionSession(String connectionId, String dialectId, String url, String username, String password, Connection connection, long lastUsedAtMs)
    {
        FileConnectionSession touch(long now)
        {
            return new FileConnectionSession(connectionId, dialectId, url, username, password, connection, now);
        }

        boolean matches(JdbcExecutionState state)
        {
            return same(connectionId, state.connectionId())
                    && same(dialectId, state.dialectId())
                    && same(url, state.url())
                    && same(username, state.username())
                    && same(password, state.resolvedPassword());
        }

        private static boolean same(String left, String right)
        {
            return left == null ? right == null
                    : left.equals(right);
        }
    }
}
