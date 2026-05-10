package com.queryeer.backend.queryengine.jdbc;

public interface JdbcRuntimeService
{
    JdbcDialectRegistry dialectRegistry();

    JdbcConnections connections();
}
