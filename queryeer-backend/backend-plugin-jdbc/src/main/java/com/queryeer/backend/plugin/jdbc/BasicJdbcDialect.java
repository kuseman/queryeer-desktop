package com.queryeer.backend.plugin.jdbc;

import static com.queryeer.backend.api.PayloadUtils.stringValue;

import java.sql.Connection;
import java.sql.Driver;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Map;
import java.util.Properties;
import java.util.ServiceLoader;

import com.queryeer.backend.api.PayloadUtils;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.execute.AbstractJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;

final class BasicJdbcDialect implements JdbcDialect
{
    private final JdbcQueryExecutor queryExecutor = new AbstractJdbcQueryExecutor()
    {
    };

    @Override
    public JdbcDialectMetadata metadata()
    {
        return new JdbcDialectMetadata("jdbc", "Generic JDBC", null, "jdbc:<driver>://<host>:<port>/<database>", null);
    }

    @Override
    public String sqlGrammarId()
    {
        return JdbcDialect.DEFAULT_SQL_GRAMMAR_ID;
    }

    @Override
    public String buildUrl(Map<String, Object> materializedProperties)
    {
        return PayloadUtils.stringValue(materializedProperties, JdbcConnection.KEY_URL);
    }

    @Override
    public JdbcQueryExecutor queryExecutor()
    {
        return queryExecutor;
    }

    @Override
    public Connection openSessionConnection(Map<String, Object> materializedProperties) throws SQLException
    {
        String url = buildUrl(materializedProperties);
        if (url == null)
        {
            throw new IllegalArgumentException("Connection profile has no url");
        }
        Properties properties = new Properties();
        String username = stringValue(materializedProperties, JdbcConnection.KEY_USERNAME);
        if (username != null)
        {
            properties.setProperty("user", username);
        }
        String password = stringValue(materializedProperties, JdbcConnection.KEY_PASSWORD);
        if (password != null)
        {
            properties.setProperty("password", password);
        }
        try
        {
            return DriverManager.getConnection(url, properties);
        }
        catch (SQLException e)
        {
            // DriverManager failed — driver may not be registered with AppClassLoader.
            // Try ServiceLoader with the plugin's classloader (which delegates to SharedClassLoader).
            if (e.getMessage() != null
                    && e.getMessage()
                            .contains("No suitable driver"))
            {
                Connection conn = connectViaDriverServiceLoader(url, properties);
                if (conn != null)
                {
                    return conn;
                }
            }
            throw e;
        }
    }

    private static Connection connectViaDriverServiceLoader(String url, Properties properties)
    {
        ClassLoader cl = Thread.currentThread()
                .getContextClassLoader();
        if (cl == null)
        {
            return null;
        }
        ServiceLoader<Driver> drivers = ServiceLoader.load(Driver.class, cl);
        for (Driver driver : drivers)
        {
            try
            {
                return driver.connect(url, properties);
            }
            catch (SQLException ignored)
            {
            }
        }
        return null;
    }
}
