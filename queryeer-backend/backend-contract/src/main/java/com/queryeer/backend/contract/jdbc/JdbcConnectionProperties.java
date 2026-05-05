package com.queryeer.backend.contract.jdbc;

import java.util.Map;

/**
 * Inline JDBC connection properties used by connection test and inline engine states.
 */
public record JdbcConnectionProperties(String dialectId, String url, String username, Object password, String host, Integer port, String database, Map<String, Object> properties, Boolean enabled)
{
}
