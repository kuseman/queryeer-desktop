package com.queryeer.backend.plugin.jdbc.schema;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class JdbcConnectionHealthTest
{
    @Test
    void healthyByDefault()
    {
        JdbcConnectionHealth health = new JdbcConnectionHealth(2, 60_000);
        assertTrue(health.isHealthy("conn-1"));
    }

    @Test
    void singleFailureStillHealthy()
    {
        JdbcConnectionHealth health = new JdbcConnectionHealth(2, 60_000);
        health.onFailure("conn-1");
        assertTrue(health.isHealthy("conn-1"));
    }

    @Test
    void consecutiveFailuresBreaksCircuit()
    {
        JdbcConnectionHealth health = new JdbcConnectionHealth(2, 60_000);
        health.onFailure("conn-1");
        health.onFailure("conn-1");
        assertFalse(health.isHealthy("conn-1"));
    }

    @Test
    void onSuccessResetsFailures()
    {
        JdbcConnectionHealth health = new JdbcConnectionHealth(2, 60_000);
        health.onFailure("conn-1");
        health.onSuccess("conn-1");
        health.onFailure("conn-1");
        assertTrue(health.isHealthy("conn-1"));
    }

    @Test
    void differentConnectionsAreIndependent()
    {
        JdbcConnectionHealth health = new JdbcConnectionHealth(2, 60_000);
        health.onFailure("conn-a");
        health.onFailure("conn-a");
        assertFalse(health.isHealthy("conn-a"));
        assertTrue(health.isHealthy("conn-b"));
    }

    @Test
    void resetClearsFailures()
    {
        JdbcConnectionHealth health = new JdbcConnectionHealth(2, 60_000);
        health.onFailure("conn-1");
        health.onFailure("conn-1");
        assertFalse(health.isHealthy("conn-1"));
        health.reset("conn-1");
        assertTrue(health.isHealthy("conn-1"));
    }

    @Test
    void cooldownExpiresAfterInterval() throws Exception
    {
        JdbcConnectionHealth health = new JdbcConnectionHealth(2, 50L); // 50ms cooldown
        health.onFailure("conn-1");
        health.onFailure("conn-1");
        assertFalse(health.isHealthy("conn-1"));
        Thread.sleep(100L);
        assertTrue(health.isHealthy("conn-1"));
    }
}
