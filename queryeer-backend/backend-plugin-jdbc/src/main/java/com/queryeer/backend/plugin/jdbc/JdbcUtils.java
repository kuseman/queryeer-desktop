package com.queryeer.backend.plugin.jdbc;

import static com.queryeer.backend.api.PayloadUtils.trimToNull;

import java.sql.Connection;
import java.sql.SQLException;

public final class JdbcUtils
{
    public static String normalizeIdentifier(String value)
    {
        String trimmed = trimToNull(value);
        if (trimmed == null)
        {
            return null;
        }
        String unwrapped = trimmed;
        if (unwrapped.startsWith("[")
                && unwrapped.endsWith("]")
                && unwrapped.length() > 1)
        {
            unwrapped = unwrapped.substring(1, unwrapped.length() - 1);
        }
        if ((unwrapped.startsWith("\"")
                && unwrapped.endsWith("\""))
                || (unwrapped.startsWith("`")
                        && unwrapped.endsWith("`")
                        || (unwrapped.startsWith("'")
                                && unwrapped.endsWith("'"))))
        {
            if (unwrapped.length() > 1)
            {
                unwrapped = unwrapped.substring(1, unwrapped.length() - 1);
            }
        }
        return unwrapped.trim()
                .toLowerCase();
    }

    static void rollbackAndClose(Connection connection)
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

    static void closeQuietly(Connection connection)
    {
        try
        {
            connection.close();
        }
        catch (SQLException ignored)
        {
        }
    }
}
