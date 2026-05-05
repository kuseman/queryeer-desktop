package com.queryeer.backend.contract.jdbc;

import java.util.Map;

/**
 * Payload for {@code jdbc.schema.fetch} engine action.
 */
public record JdbcSchemaFetchPayload(String connectionId, Map<String, Object> properties, String scope, JdbcSchemaTarget target)
{
}
