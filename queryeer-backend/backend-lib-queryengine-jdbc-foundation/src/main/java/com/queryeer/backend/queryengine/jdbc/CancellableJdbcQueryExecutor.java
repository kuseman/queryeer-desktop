package com.queryeer.backend.queryengine.jdbc;

public interface CancellableJdbcQueryExecutor extends JdbcQueryExecutor
{
    void cancel(String queryExecutionId);
}
