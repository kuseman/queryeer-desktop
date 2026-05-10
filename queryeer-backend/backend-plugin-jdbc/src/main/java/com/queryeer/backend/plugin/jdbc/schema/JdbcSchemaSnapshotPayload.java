package com.queryeer.backend.plugin.jdbc.schema;

/**
 * Payload for {@code jdbc.schema.snapshot} engine action.
 */
public record JdbcSchemaSnapshotPayload(String connectionId, String scope)
{
}
