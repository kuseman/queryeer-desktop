package com.queryeer.backend.plugin.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.Objects;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;

final class JdbcFileConnectionManager
{
    private static final long DEFAULT_IDLE_TIMEOUT_MS = TimeUnit.MINUTES.toMillis(30);
    private final Map<String, FileSessionHandle> byFileId = new ConcurrentHashMap<>();
    private final long idleTimeoutMs;

    JdbcFileConnectionManager()
    {
        this(DEFAULT_IDLE_TIMEOUT_MS);
    }

    JdbcFileConnectionManager(long idleTimeoutMs)
    {
        this.idleTimeoutMs = Math.max(0L, idleTimeoutMs);
    }

    Connection acquire(String fileId, JdbcConnectionProfile profile) throws SQLException
    {
        long now = System.currentTimeMillis();
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

            Connection connection = openConnection(profile);
            return new FileSessionHandle(profile.connectionId(), profile.dialectId(), text(profile.properties(), "url"), text(profile.properties(), "username"), text(profile.properties(), "password"),
                    connection, now);
        });

        return session.connection();
    }

    void closeFile(String fileId)
    {
        FileSessionHandle removed = byFileId.remove(fileId);
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

    private static Connection openConnection(JdbcConnectionProfile profile)
    {
        try
        {
            Map<String, Object> props = profile.properties();
            String url = text(props, "url");
            if (url == null)
            {
                throw new IllegalArgumentException("Connection profile has no url");
            }
            Properties properties = new Properties();
            String username = text(props, "username");
            if (username != null)
            {
                properties.setProperty("user", username);
            }
            String password = text(props, "password");
            if (password != null)
            {
                properties.setProperty("password", password);
            }
            return DriverManager.getConnection(url, properties);
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

    private record FileSessionHandle(String connectionId, String dialectId, String url, String username, String password, Connection connection, long lastUsedAtMs)
    {
        FileSessionHandle touch(long now)
        {
            return new FileSessionHandle(connectionId, dialectId, url, username, password, connection, now);
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
    }
}
