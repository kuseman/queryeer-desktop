package com.queryeer.backend.queryengine.jdbc.execute;

import java.sql.Connection;
import java.util.Map;

import com.queryeer.backend.queryengine.jdbc.JdbcDialect;

public record JdbcQueryRequest(String queryExecutionId, String fileId, String sql, String connectionId, Map<String, Object> connectionProperties, Connection sessionConnection, String database,
        JdbcDialect dialect)
{
}
