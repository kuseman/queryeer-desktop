package com.queryeer.backend.queryengine.jdbc;

public interface JdbcDialectContributor
{
    void contribute(JdbcDialectRegistry registry);
}
