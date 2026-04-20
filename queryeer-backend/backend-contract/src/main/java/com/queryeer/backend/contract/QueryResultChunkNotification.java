package com.queryeer.backend.contract.query;

import java.util.List;

public record QueryResultChunkNotification(String queryExecutionId, int chunkIndex, ResultSchema schema, List<List<Object>> rows, boolean isLastChunk)
{
}
