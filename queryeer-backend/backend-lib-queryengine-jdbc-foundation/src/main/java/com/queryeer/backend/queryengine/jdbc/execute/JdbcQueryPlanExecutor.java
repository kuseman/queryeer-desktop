package com.queryeer.backend.queryengine.jdbc.execute;

public interface JdbcQueryPlanExecutor
{
    JdbcQueryResult executeWithPlan(JdbcQueryRequest request, JdbcQueryEventListener eventListener);
}
