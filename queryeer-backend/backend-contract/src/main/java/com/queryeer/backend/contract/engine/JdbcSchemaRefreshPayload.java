package com.queryeer.backend.contract.engine;

import com.queryeer.backend.contract.jdbc.JdbcSchemaTarget;

public record JdbcSchemaRefreshPayload(String connectionId, String scope, JdbcSchemaTarget target)
{
}
