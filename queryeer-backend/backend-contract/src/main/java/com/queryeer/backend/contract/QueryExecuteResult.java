package com.queryeer.backend.contract.query;

public record QueryExecuteResult(boolean accepted, String queryExecutionId)
{
}
