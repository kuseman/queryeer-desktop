package com.queryeer.backend.api;

public interface QueryEngineProvider
{
    String engineId();

    void execute(String queryExecutionId, String fileId, String text, Object engineState, QueryPublisher publisher);

    default Object invoke(String fileId, String action, Object payload)
    {
        throw new IllegalArgumentException("Unsupported engine action '" + action + "' for engine '" + engineId() + "'");
    }

    void cancel(String queryExecutionId);
}
