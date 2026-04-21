package com.queryeer.backend.contract.query;

public record QueryCancelResult(boolean accepted, String queryExecutionId)
{
}
