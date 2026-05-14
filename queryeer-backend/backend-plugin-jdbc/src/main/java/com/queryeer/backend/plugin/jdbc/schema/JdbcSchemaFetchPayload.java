package com.queryeer.backend.plugin.jdbc.schema;

import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

/**
 * Payload for {@code jdbc.schema.fetch} engine action.
 */
public record JdbcSchemaFetchPayload(String connectionId, String parentKind, String scope, JdbcSchemaTarget target)
{
}
