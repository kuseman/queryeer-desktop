package com.queryeer.backend.contract.query;

import java.util.List;

public record QueryExecuteParams(String queryExecutionId, String engineId, String connectionId, String fileId, String text, List<Object> parameters, Object engineState, QueryExecuteOptions options)
{
}
