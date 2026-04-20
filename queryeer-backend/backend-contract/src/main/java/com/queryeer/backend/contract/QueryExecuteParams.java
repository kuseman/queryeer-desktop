package com.queryeer.backend.contract.query;

import java.util.List;

public record QueryExecuteParams(String queryExecutionId, String engineId, String connectionId, String text, List<Object> parameters, QueryExecuteOptions options)
{
}
