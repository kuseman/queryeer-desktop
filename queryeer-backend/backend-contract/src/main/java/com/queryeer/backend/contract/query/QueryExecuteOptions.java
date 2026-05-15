package com.queryeer.backend.contract.query;

import java.util.List;
import java.util.Map;

public record QueryExecuteOptions(Integer maxRows, Integer timeoutMs, String intent, List<QueryRequestedArtifact> requestedArtifacts, Map<String, Object> dialectOptions)
{
}
