package com.queryeer.backend.plugin.jdbc.schema;

import java.time.Instant;
import java.util.List;

import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.plugin.jdbc.DefaultJdbcConnections;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaTarget;

public final class JdbcSchemaCrawlCoordinator
{
    private final DefaultJdbcConnections connections;
    private final JdbcSchemaCrawler crawler;
    private final JdbcSchemaStore store;
    private final JdbcSchemaCrawlPolicy policy;
    private final LoggerService logger;

    public JdbcSchemaCrawlCoordinator(DefaultJdbcConnections connections, JdbcSchemaCrawler crawler, JdbcSchemaStore store, JdbcSchemaCrawlPolicy policy, LoggerService logger)
    {
        this.connections = connections;
        this.crawler = crawler;
        this.store = store;
        this.policy = policy;
        this.logger = logger;
    }

    public void start(long intervalMs)
    {
        Thread thread = new Thread(() -> loop(intervalMs), "jdbc-schema-crawl-loop");
        thread.setDaemon(true);
        thread.setContextClassLoader(getClass().getClassLoader());
        thread.setUncaughtExceptionHandler((_, e) -> logger.error("JDBC schema crawl loop crashed", e));
        thread.start();
    }

    public void onUsage(String connectionId)
    {
        onUsage(connectionId, null);
    }

    public void onUsage(String connectionId, String database)
    {
        if (connectionId == null
                || connectionId.isBlank())
        {
            return;
        }
        store.recordUsage(connectionId, JdbcSchemaCrawlScope.TOP, Instant.now());
        store.recordUsage(connectionId, JdbcSchemaCrawlScope.DEEP, database, Instant.now());
    }

    public List<JdbcSchemaObject> refreshNow(String connectionId, JdbcSchemaCrawlScope scope, JdbcSchemaTarget target)
    {
        if (connectionId == null
                || connectionId.isBlank())
        {
            throw new IllegalArgumentException("connectionId is required");
        }
        JdbcConnection jdbcConnection = connections.resolve(connectionId);
        crawlOne(jdbcConnection, scope, true, target, Instant.now());
        return store.latestSnapshot(connectionId, scope);
    }

    private void loop(long intervalMs)
    {
        while (!Thread.currentThread()
                .isInterrupted())
        {
            try
            {
                List<String> current = connections.allConfiguredConnectionIds();
                for (String connectionId : current)
                {
                    crawlOneSilent(connectionId, JdbcSchemaCrawlScope.TOP, false, null, Instant.now());
                    List<String> databaseKeys = store.databaseKeys(connectionId, JdbcSchemaCrawlScope.DEEP);
                    if (databaseKeys.isEmpty())
                    {
                        crawlOneSilent(connectionId, JdbcSchemaCrawlScope.DEEP, false, null, Instant.now());
                    }
                    else
                    {
                        for (String database : databaseKeys)
                        {
                            crawlOneSilent(connectionId, JdbcSchemaCrawlScope.DEEP, false, new JdbcSchemaTarget(database, null), Instant.now());
                        }
                    }
                }
            }
            catch (RuntimeException e)
            {
                logger.warn("Schema crawl loop iteration failed: " + e.getMessage());
            }
            sleepQuietly(Math.max(500L, intervalMs));
        }
    }

    private void crawlOneSilent(String connectionId, JdbcSchemaCrawlScope scope, boolean force, JdbcSchemaTarget target, Instant now)
    {
        try
        {
            JdbcConnection connection = connections.resolve(connectionId);
            crawlOne(connection, scope, force, target, now);
        }
        catch (SecuritySessionClosedException e)
        {
            // Silently skip connections that require a locked vault
        }
    }

    private void crawlOne(JdbcConnection connection, JdbcSchemaCrawlScope scope, boolean force, JdbcSchemaTarget target, Instant now)
    {
        String connectionId = connection.connectionId();
        String databaseKey = target != null ? target.database()
                : null;
        if (!force
                && !store.isDue(connectionId, scope, databaseKey, now))
        {
            return;
        }

        JdbcSchemaStore.CrawlState state = store.readState(connectionId, scope, databaseKey);
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
        store.updateState(connectionId, scope, databaseKey, nextState, now, now.plusMillis(Math.max(500L, jitteredMs)));
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
