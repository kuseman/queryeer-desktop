package com.queryeer.backend.contract.query;

import java.util.List;

public record QueryChunkRowsNotification(String queryExecutionId, int resultSetIndex, List<List<Object>> rows)
{
}
