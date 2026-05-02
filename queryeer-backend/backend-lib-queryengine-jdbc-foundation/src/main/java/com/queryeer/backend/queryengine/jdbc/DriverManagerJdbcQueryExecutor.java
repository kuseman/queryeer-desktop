package com.queryeer.backend.queryengine.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Properties;

public class DriverManagerJdbcQueryExecutor extends AbstractJdbcQueryExecutor
{
    public DriverManagerJdbcQueryExecutor()
    {
        super();
    }

    public DriverManagerJdbcQueryExecutor(int rowChunkSize)
    {
        super(rowChunkSize);
    }

    @Override
    protected Connection openConnection(JdbcConnectionProfile profile) throws SQLException
    {
        String url = text(profile.properties()
                .get("url"));
        if (url == null)
        {
            throw new IllegalArgumentException("JDBC connection url is required");
        }
        Properties properties = new Properties();
        String username = text(profile.properties()
                .get("username"));
        String password = text(profile.properties()
                .get("password"));
        if (username != null)
        {
            properties.setProperty("user", username);
        }
        if (password != null)
        {
            properties.setProperty("password", password);
        }
        return DriverManager.getConnection(url, properties);
    }

    private static String text(Object value)
    {
        if (value instanceof String stringValue)
        {
            String trimmed = stringValue.trim();
            return trimmed.isBlank() ? null
                    : trimmed;
        }
        return null;
    }
}
