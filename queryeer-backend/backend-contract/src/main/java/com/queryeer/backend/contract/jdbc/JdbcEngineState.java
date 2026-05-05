package com.queryeer.backend.contract.jdbc;

/**
 * Engine state sent into JDBC query execution. Supports both registry lookup ({@code connectionId}) and inline connection properties ({@code dialectId}, {@code url}, etc.).
 */
public record JdbcEngineState(String connectionId, String database, String sessionId, JdbcNestedConnection jdbc, String dialectId, String url, java.util.Map<String, Object> properties)
{
    public record JdbcNestedConnection(java.util.Map<String, Object> connection)
    {
    }
}
