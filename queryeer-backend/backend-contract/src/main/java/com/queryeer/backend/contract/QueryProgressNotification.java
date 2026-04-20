package com.queryeer.backend.contract.query;

public record QueryProgressNotification(String queryExecutionId, Integer percent, String message)
{
}
