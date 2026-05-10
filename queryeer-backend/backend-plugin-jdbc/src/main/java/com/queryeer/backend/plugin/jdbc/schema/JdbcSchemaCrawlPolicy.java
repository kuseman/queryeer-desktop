package com.queryeer.backend.plugin.jdbc.schema;

import java.time.Duration;

public final class JdbcSchemaCrawlPolicy
{
    Duration intervalFor(JdbcSchemaCrawlScope scope, double usageScore, boolean enabled, int consecutiveFailures)
    {
        if (!enabled)
        {
            return Duration.ZERO;
        }
        if (scope == JdbcSchemaCrawlScope.TOP)
        {
            return Duration.ofMinutes(2);
        }
        Duration base = baseIntervalFor(usageScore);
        long multiplier = consecutiveFailures <= 0 ? 1L
                : Math.min(16L, 1L << Math.min(4, consecutiveFailures));
        long millis = Math.min(Duration.ofDays(7)
                .toMillis(), base.toMillis() * multiplier);
        return Duration.ofMillis(millis);
    }

    private static Duration baseIntervalFor(double usageScore)
    {
        if (usageScore >= 0.8d)
        {
            return Duration.ofMinutes(5);
        }
        if (usageScore >= 0.5d)
        {
            return Duration.ofHours(1);
        }
        if (usageScore >= 0.2d)
        {
            return Duration.ofHours(6);
        }
        return Duration.ofDays(1);
    }
}
