package com.queryeer.backend.plugin.jdbc.schema;

import java.time.Instant;

public record JdbcSchemaCrawlStatus(String connectionId, String connectionTitle, String scope, String databaseKey, Instant lastSuccessAt, Instant lastAttemptAt, Instant lastFailureAt,
        Instant nextDueAt, int consecutiveFailures, double usageScore, boolean enabled, int objectCount, String lastError)
{
}
