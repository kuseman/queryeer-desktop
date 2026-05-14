package com.queryeer.backend.plugin.jdbc.schema;

import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

public record JdbcSchemaRefreshPayload(String connectionId, String scope, JdbcSchemaTarget target, String mode, Boolean waitForCompletion)
{
}
