package com.queryeer.backend.plugin.jdbc;

import java.time.Duration;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class JdbcSchemaCrawlPolicyTest
{
    private final JdbcSchemaCrawlPolicy policy = new JdbcSchemaCrawlPolicy();

    @Test
    void returnsZeroWhenDisabled()
    {
        Assertions.assertEquals(Duration.ZERO, policy.intervalFor(JdbcSchemaCrawlScope.DEEP, 0.9d, false, 0));
    }

    @Test
    void returnsShortIntervalForHotUsage()
    {
        Assertions.assertEquals(Duration.ofMinutes(5), policy.intervalFor(JdbcSchemaCrawlScope.DEEP, 0.95d, true, 0));
    }

    @Test
    void appliesFailureBackoff()
    {
        Assertions.assertEquals(Duration.ofHours(4), policy.intervalFor(JdbcSchemaCrawlScope.DEEP, 0.5d, true, 2));
    }

    @Test
    void topScopeUsesFixedInterval()
    {
        Assertions.assertEquals(Duration.ofMinutes(2), policy.intervalFor(JdbcSchemaCrawlScope.TOP, 0.1d, true, 4));
    }
}
