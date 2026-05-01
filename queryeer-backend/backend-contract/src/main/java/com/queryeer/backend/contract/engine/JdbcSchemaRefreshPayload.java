package com.queryeer.backend.contract.engine;

import java.util.Map;

public record JdbcSchemaRefreshPayload(String connectionId, String scope, Map<String, Object> target)
{
}
