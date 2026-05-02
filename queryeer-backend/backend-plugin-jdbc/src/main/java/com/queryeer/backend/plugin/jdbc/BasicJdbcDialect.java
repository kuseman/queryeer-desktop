package com.queryeer.backend.plugin.jdbc;

import java.util.List;

import com.queryeer.backend.queryengine.jdbc.DriverManagerJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionSetupDefinition;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.JdbcSchemaResolver;

final class BasicJdbcDialect implements JdbcDialect
{
    private final JdbcQueryExecutor queryExecutor = new DriverManagerJdbcQueryExecutor();
    private final JdbcSchemaResolver schemaResolver = new InformationSchemaJdbcSchemaResolver();

    @Override
    public JdbcDialectMetadata metadata()
    {
        return new JdbcDialectMetadata("jdbc", "Generic JDBC", null, "jdbc:<driver>://<host>:<port>/<database>", null);
    }

    @Override
    public JdbcConnectionSetupDefinition connectionSetup()
    {
        return new JdbcConnectionSetupDefinition(List.of());
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
}
