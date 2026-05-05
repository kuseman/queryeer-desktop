package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Properties;

import com.queryeer.backend.queryengine.jdbc.JdbcConnectionSetupDefinition;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaResolver;

public final class SqlServerDialect implements JdbcDialect
{
    static final String DIALECT_ID = "sqlserver";

    private final SqlServerQueryExecutor queryExecutor = new SqlServerQueryExecutor();
    private final SqlServerSchemaResolver schemaResolver = new SqlServerSchemaResolver();

    @Override
    public JdbcDialectMetadata metadata()
    {
        return new JdbcDialectMetadata(DIALECT_ID, "Microsoft SQL Server", 1433, "jdbc:sqlserver://<host>:<port>;databaseName=<database>", "com.microsoft.sqlserver.jdbc.SQLServerDriver");
    }

    @Override
    public JdbcConnectionSetupDefinition connectionSetup()
    {
        return SqlServerConnectionSetup.build();
    }

    @Override
    public JdbcQueryExecutor queryExecutor()
    {
        return queryExecutor;
    }

    @Override
    public JdbcSchemaResolver schemaResolver()
    {
        return schemaResolver;
    }

    @Override
    public boolean requiresExplicitUrl()
    {
        return false;
    }

    @Override
    public String resolveSessionId(Connection connection) throws SQLException
    {
        try (Statement statement = connection.createStatement(); ResultSet rs = statement.executeQuery("select @@SPID"))
        {
            if (!rs.next())
            {
                return "";
            }
            Object value = rs.getObject(1);
            if (value == null)
            {
                return "";
            }
            String text = String.valueOf(value)
                    .trim();
            return text;
        }
        catch (SQLException ignored)
        {
            return "";
        }
    }

    @Override
    public Connection openSessionConnection(com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile profile) throws SQLException
    {
        String url = SqlServerUrlBuilder.buildUrl(profile.properties());
        Properties jdbcProps = SqlServerUrlBuilder.buildConnectionProperties(profile.properties());
        return DriverManager.getConnection(url, jdbcProps);
    }
}
