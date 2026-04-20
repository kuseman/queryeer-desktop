package com.queryeer.backend.contract.query;

public record QueryCompletedNotification(String queryExecutionId, QueryMetrics metrics)
{
}
