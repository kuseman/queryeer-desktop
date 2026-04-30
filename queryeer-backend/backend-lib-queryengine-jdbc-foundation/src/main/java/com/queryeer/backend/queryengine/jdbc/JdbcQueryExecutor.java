package com.queryeer.backend.queryengine.jdbc;

public interface JdbcQueryExecutor
{
    JdbcQueryResult execute(JdbcQueryRequest request, JdbcQueryEventListener eventListener);
}
