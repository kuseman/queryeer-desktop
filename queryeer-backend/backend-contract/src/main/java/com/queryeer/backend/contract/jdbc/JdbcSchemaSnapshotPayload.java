package com.queryeer.backend.contract.jdbc;

/**
 * Payload for {@code jdbc.schema.snapshot} engine action.
 */
public record JdbcSchemaSnapshotPayload(String connectionId, String scope)
{
}
