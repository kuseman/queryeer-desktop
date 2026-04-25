package com.queryeer.backend.api;

public interface QueryEngineProvider
{
    String engineId();

    void execute(String queryExecutionId, String text, QueryPublisher publisher);

    void cancel(String queryExecutionId);
}
