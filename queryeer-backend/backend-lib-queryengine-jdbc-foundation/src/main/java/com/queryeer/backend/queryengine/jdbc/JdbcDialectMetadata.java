package com.queryeer.backend.queryengine.jdbc;

public record JdbcDialectMetadata(String id, String displayName, Integer defaultPort, String jdbcUrlTemplate, String driverClassName)
{
}
