package com.queryeer.backend.queryengine.jdbc;

import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryExecutor;

public interface CancellableJdbcQueryExecutor extends JdbcQueryExecutor
{
    void cancel(String queryExecutionId);
}
