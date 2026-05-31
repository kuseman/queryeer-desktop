package com.queryeer.example.jdbc.h2;

import com.queryeer.backend.queryengine.jdbc.JdbcDialectContributor;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

public final class H2DialectContributor implements JdbcDialectContributor
{
    @Override
    public void contribute(JdbcDialectRegistry registry)
    {
        registry.register(new H2Dialect());
    }
}
