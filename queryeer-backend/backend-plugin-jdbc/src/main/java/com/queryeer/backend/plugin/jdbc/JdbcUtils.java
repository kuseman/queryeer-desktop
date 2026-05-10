package com.queryeer.backend.plugin.jdbc;

import java.sql.Connection;
import java.sql.SQLException;

final class JdbcUtils
{

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
