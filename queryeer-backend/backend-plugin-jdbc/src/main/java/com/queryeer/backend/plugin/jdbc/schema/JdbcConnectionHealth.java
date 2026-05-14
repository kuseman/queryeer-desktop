package com.queryeer.backend.plugin.jdbc.schema;

import java.time.Instant;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Simple circuit breaker per connection. After {@code threshold} consecutive failures a connection is marked BROKEN and background operations skip it until the cooldown expires.
 *
 * <p>
 * User-initiated operations (tree expand, completion, symbol lookup) always attempt a connection regardless of health — they just fail fast with the login timeout.
 */
public final class JdbcConnectionHealth
{
    private static final int DEFAULT_THRESHOLD = 2;
    private static final long DEFAULT_COOLDOWN_MS = 60_000L;

    private final int threshold;
    private final long cooldownMs;
    private final ConcurrentHashMap<String, ConnectionState> states = new ConcurrentHashMap<>();

    public JdbcConnectionHealth()
    {
        this(DEFAULT_THRESHOLD, DEFAULT_COOLDOWN_MS);
    }

    JdbcConnectionHealth(int threshold, long cooldownMs)
    {
        this.threshold = threshold;
        this.cooldownMs = cooldownMs;
    }

    /** Report a successful connection. Resets the failure count. */
    public void onSuccess(String connectionId)
    {
        states.compute(connectionId, (_, state) ->
        {
            if (state == null)
            {
                return null;
            }
            return state.consecutiveFailures > 0 ? new ConnectionState(0, state.lastFailureTime)
                    : null;
        });
    }

    /** Report a failed connection. Returns true if the connection is now BROKEN. */
    public boolean onFailure(String connectionId)
    {
        return states.compute(connectionId, (_, state) ->
        {
            int failures = (state == null ? 0
                    : state.consecutiveFailures) + 1;
            return new ConnectionState(failures, Instant.now());
        }).consecutiveFailures >= threshold;
    }

    /**
     * Returns true if the connection is healthy for background operations. A BROKEN connection transitions back to healthy after the cooldown expires.
     */
    public boolean isHealthy(String connectionId)
    {
        ConnectionState state = states.get(connectionId);
        if (state == null)
        {
            return true;
        }
        if (state.consecutiveFailures < threshold)
        {
            return true;
        }
        // Check cooldown
        if (state.lastFailureTime.plusMillis(cooldownMs)
                .isBefore(Instant.now()))
        {
            // Cooldown expired — reset and allow retry
            states.remove(connectionId);
            return true;
        }
        return false;
    }

    /** Reset health for a connection (e.g. when user explicitly connects). */
    public void reset(String connectionId)
    {
        states.remove(connectionId);
    }

    private record ConnectionState(int consecutiveFailures, Instant lastFailureTime)
    {
    }
}
