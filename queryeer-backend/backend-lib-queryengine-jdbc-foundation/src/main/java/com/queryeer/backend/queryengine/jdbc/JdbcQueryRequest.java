package com.queryeer.backend.queryengine.jdbc;

import java.sql.Connection;
import java.util.List;

public record JdbcQueryRequest(String queryExecutionId, String fileId, String sql, List<Object> parameters, JdbcConnectionProfile connection, Connection sessionConnection, String database,
        JdbcDialect dialect)
{
}
