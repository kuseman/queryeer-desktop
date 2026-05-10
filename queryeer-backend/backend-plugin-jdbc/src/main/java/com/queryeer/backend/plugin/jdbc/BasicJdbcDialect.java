package com.queryeer.backend.plugin.jdbc;

import java.util.Map;

import com.queryeer.backend.api.PayloadUtils;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.execute.AbstractJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaResolver;

final class BasicJdbcDialect implements JdbcDialect
{
    private final JdbcQueryExecutor queryExecutor = new AbstractJdbcQueryExecutor()
    {
    };
    private final JdbcSchemaResolver schemaResolver = new InformationSchemaJdbcSchemaResolver();

    @Override
    public JdbcDialectMetadata metadata()
    {
        return new JdbcDialectMetadata("jdbc", "Generic JDBC", null, "jdbc:<driver>://<host>:<port>/<database>", null);
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
    public JdbcSchemaResolver schemaResolver()
    {
        return schemaResolver;
    }
}
