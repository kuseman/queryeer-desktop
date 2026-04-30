package com.queryeer.backend.contract.query;

import java.util.List;

public record QueryExecuteParams(String queryExecutionId, String engineId, String fileId, String text, List<Object> parameters, Object engineState, QueryExecuteOptions options)
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
