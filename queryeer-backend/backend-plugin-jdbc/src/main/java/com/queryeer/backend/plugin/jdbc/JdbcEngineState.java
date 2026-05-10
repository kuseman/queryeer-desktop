package com.queryeer.backend.plugin.jdbc;

/**
 * Engine state sent into JDBC query execution.
 */
public record JdbcEngineState(String connectionId, String database, String sessionId)
{
}
