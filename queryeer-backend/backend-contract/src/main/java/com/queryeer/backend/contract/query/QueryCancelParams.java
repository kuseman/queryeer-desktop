package com.queryeer.backend.contract.query;

public record QueryCancelParams(String queryExecutionId, String reason)
{
}
