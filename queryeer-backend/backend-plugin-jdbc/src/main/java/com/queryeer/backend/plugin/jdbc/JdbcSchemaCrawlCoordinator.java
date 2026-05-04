package com.queryeer.backend.plugin.jdbc;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.LoggerService;

final class JdbcSchemaCrawlCoordinator
{
    private final JdbcConnectionRegistry connections;
    private final JdbcSchemaCrawler crawler;
    private final JdbcSchemaStore store;
    private final JdbcSchemaCrawlPolicy policy;
    private final JdbcSecuritySessionState securitySessionState;
    private final JdbcSettingsConnectionSource settingsSource;
    private final ConfigService config;
    private final LoggerService logger;

    JdbcSchemaCrawlCoordinator(JdbcConnectionRegistry connections, JdbcSchemaCrawler crawler, JdbcSchemaStore store, JdbcSchemaCrawlPolicy policy, JdbcSecuritySessionState securitySessionState,
            JdbcSettingsConnectionSource settingsSource, ConfigService config, LoggerService logger)
    {
        this.connections = connections;
        this.crawler = crawler;
        this.store = store;
        this.policy = policy;
        this.securitySessionState = securitySessionState;
        this.settingsSource = settingsSource;
        this.config = config;
        this.logger = logger;
    }

    void start(long intervalMs)
    {
        Thread thread = new Thread(() -> loop(intervalMs), "jdbc-schema-crawl-loop");
        thread.setDaemon(true);
        thread.start();
    }

    void onUsage(String connectionId)
    {
        if (connectionId == null
                || connectionId.isBlank())
        {
            return;
        }
        store.recordUsage(connectionId, JdbcSchemaCrawlScope.TOP, Instant.now());
    }

    void onConnectionUpsert(String connectionId)
    {
        if (connectionId == null
                || connectionId.isBlank())
        {
            return;
        }
        Instant now = Instant.now();
        JdbcSchemaStore.CrawlState topState = store.readState(connectionId, JdbcSchemaCrawlScope.TOP);
        store.updateState(connectionId, JdbcSchemaCrawlScope.TOP, topState, now, Instant.EPOCH);
        if (securitySessionState.isOpen())
        {
            findConnection(connectionId).ifPresent(connection -> crawlOne(connection, JdbcSchemaCrawlScope.TOP, true, null, now));
        }
    }

    List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> refreshNow(String connectionId, JdbcSchemaCrawlScope scope, JdbcSchemaTarget target)
    {
        if (connectionId == null
                || connectionId.isBlank())
        {
            throw new IllegalArgumentException("connectionId is required");
        }
        if (!securitySessionState.isOpen())
        {
            throw new IllegalStateException("security.session.open is required before schema refresh");
        }
        JdbcConnectionRegistry.JdbcStoredConnection stored = findConnection(connectionId).orElseThrow(() -> new IllegalArgumentException("Unknown connectionId: " + connectionId));
        if (scope == JdbcSchemaCrawlScope.DEEP
                && target == null)
        {
            throw new IllegalArgumentException("target is required for scope=deep");
        }
        crawlOne(stored, scope, true, target, Instant.now());
        return store.latestSnapshot(connectionId, scope);
    }

    private void loop(long intervalMs)
    {
        while (!Thread.currentThread()
                .isInterrupted())
        {
            settingsSource.load(config, logger)
                    .forEach(loaded -> connections.upsert(loaded.connectionId(), loaded.name(), loaded.connection()));

            if (!securitySessionState.isOpen())
            {
                sleepQuietly(1_000L);
                continue;
            }

            List<JdbcConnectionRegistry.JdbcStoredConnection> current = connections.all();
            for (JdbcConnectionRegistry.JdbcStoredConnection connection : current)
            {
                crawlOne(connection, JdbcSchemaCrawlScope.TOP, false, null, Instant.now());
            }
            sleepQuietly(Math.max(500L, intervalMs));
        }
    }

    private void crawlOne(JdbcConnectionRegistry.JdbcStoredConnection connection, JdbcSchemaCrawlScope scope, boolean force, JdbcSchemaTarget target, Instant now)
    {
        String connectionId = connection.connectionId();
        if (!force
                && !store.isDue(connectionId, scope, now))
        {
            return;
        }

        JdbcSchemaStore.CrawlState state = store.readState(connectionId, scope);
        boolean success = false;
        try
        {
            crawler.crawl(connection, scope, target);
            success = true;
        }
        catch (RuntimeException e)
        {
            logger.warn("Schema crawl failed for connection " + connectionId + ": " + e.getMessage());
        }

        JdbcSchemaStore.CrawlState nextState = success ? state.onSuccess()
                : state.onFailure();
        long ms = policy.intervalFor(scope, nextState.usageScore(), nextState.enabled(), nextState.consecutiveFailures())
                .toMillis();
        long jitteredMs = applyJitter(ms, connectionId);
        store.updateState(connectionId, scope, nextState, now, now.plusMillis(Math.max(500L, jitteredMs)));
    }

    private Optional<JdbcConnectionRegistry.JdbcStoredConnection> findConnection(String connectionId)
    {
        return connections.get(connectionId);
    }

    private static void sleepQuietly(long millis)
    {
        try
        {
            Thread.sleep(millis);
        }
        catch (InterruptedException e)
        {
            Thread.currentThread()
                    .interrupt();
        }
    }

    private static long applyJitter(long intervalMs, String connectionId)
    {
        long magnitude = Math.max(1L, intervalMs / 10L);
        long hash = Math.abs(connectionId.hashCode());
        long offset = (hash % (2L * magnitude + 1L)) - magnitude;
        return Math.max(500L, intervalMs + offset);
    }
}
