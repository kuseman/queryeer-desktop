package com.queryeer.backend.queryengine.jdbc;

public interface JdbcConnections
{
    JdbcConnection resolve(String connectionId);
}
