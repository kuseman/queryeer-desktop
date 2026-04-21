package com.queryeer.backend.contract.query;

import com.queryeer.backend.contract.BackendError;

public record QueryFailedNotification(String queryExecutionId, BackendError error)
{
}
