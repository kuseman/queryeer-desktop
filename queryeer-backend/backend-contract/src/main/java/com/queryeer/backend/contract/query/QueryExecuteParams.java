package com.queryeer.backend.contract.query;

public record QueryExecuteParams(String queryExecutionId, String engineId, String fileId, String text, Object engineState, QueryExecuteOptions options)
{
    public QueryExecuteParams
    {
        if (fileId == null
                || fileId.isBlank())
        {
            throw new IllegalArgumentException("fileId is required for queryengine.execute");
        }
    }
}
