package com.queryeer.backend.contract.query;

import java.util.List;

public record QueryCompletedNotification(String queryExecutionId, QueryMetrics metrics, List<String> features, List<QueryOutputArtifact> artifacts, Object engineState)
{
}
