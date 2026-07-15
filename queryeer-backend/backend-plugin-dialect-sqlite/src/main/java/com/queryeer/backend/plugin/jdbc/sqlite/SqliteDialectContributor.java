package com.queryeer.backend.plugin.jdbc.sqlite;

import com.queryeer.backend.queryengine.jdbc.JdbcDialectContributor;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcDriverLoader;

final class SqliteDialectContributor implements JdbcDialectContributor
{
    private static final String DRIVER_CLASS_NAME = "org.sqlite.JDBC";

    @Override
    public void contribute(JdbcDialectRegistry registry)
    {
        JdbcDriverLoader.loadDriver(DRIVER_CLASS_NAME, getClass().getClassLoader());
        registry.register(new SqliteDialect());
    }
}
