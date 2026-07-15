package com.queryeer.backend.plugin.jdbc.sqlserver;

import com.queryeer.backend.queryengine.jdbc.JdbcDialectContributor;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcDriverLoader;

public final class SqlServerDialectContributor implements JdbcDialectContributor
{
    private static final String DRIVER_CLASS_NAME = "com.microsoft.sqlserver.jdbc.SQLServerDriver";

    @Override
    public void contribute(JdbcDialectRegistry registry)
    {
        JdbcDriverLoader.loadDriver(DRIVER_CLASS_NAME, getClass().getClassLoader());
        registry.register(new SqlServerDialect());
    }
}
