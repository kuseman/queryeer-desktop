package com.queryeer.backend.queryengine.jdbc;

public record DefaultJdbcRuntimeService(JdbcDialectRegistry dialectRegistry, JdbcConnections connections) implements JdbcRuntimeService
{
}
