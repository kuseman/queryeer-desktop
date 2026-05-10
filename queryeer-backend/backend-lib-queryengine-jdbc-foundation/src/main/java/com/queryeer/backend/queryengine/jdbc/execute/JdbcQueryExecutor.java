package com.queryeer.backend.queryengine.jdbc.execute;

public interface JdbcQueryExecutor
{
    JdbcQueryResult execute(JdbcQueryRequest request, JdbcQueryEventListener eventListener);
}
