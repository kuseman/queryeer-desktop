package com.queryeer.backend.plugin.jdbc.sqlserver;

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
}
