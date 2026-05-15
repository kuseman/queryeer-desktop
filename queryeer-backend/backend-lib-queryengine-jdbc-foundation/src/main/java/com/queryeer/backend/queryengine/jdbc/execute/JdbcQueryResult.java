package com.queryeer.backend.queryengine.jdbc.execute;

import java.util.List;
import java.util.Map;

import com.queryeer.backend.contract.query.QueryOutputArtifact;

public record JdbcQueryResult(long rowCount, Map<String, Object> engineState, List<String> features, List<QueryOutputArtifact> artifacts)
{
    public JdbcQueryResult(long rowCount, Map<String, Object> engineState)
    {
        this(rowCount, engineState, List.of("rows"), List.of());
    }
}
