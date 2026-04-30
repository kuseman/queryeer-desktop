package com.queryeer.backend.plugin.jdbc;

import com.queryeer.backend.queryengine.jdbc.JdbcDialectContributor;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

public final class BasicJdbcDialectContributor implements JdbcDialectContributor
{
    @Override
    public void contribute(JdbcDialectRegistry registry)
    {
        registry.register(new BasicJdbcDialect());
    }
}
