package com.queryeer.backend.contract.query;

public record QueryChunkStartNotification(String queryExecutionId, int resultSetIndex, ResultSchema schema)
{
}
