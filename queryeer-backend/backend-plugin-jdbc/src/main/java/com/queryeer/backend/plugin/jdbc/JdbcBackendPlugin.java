package com.queryeer.backend.plugin.jdbc;

import java.util.List;
import java.util.concurrent.TimeUnit;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.queryengine.jdbc.DefaultJdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

public final class JdbcBackendPlugin implements BackendPlugin
{
    private static final long DEFAULT_IDLE_TIMEOUT_MS = TimeUnit.MINUTES.toMillis(30);
    private static final String IDLE_TIMEOUT_KEY = "queryeer.jdbc.fileSession.idleTimeoutMs";
    private static final String REAPER_INTERVAL_KEY = "queryeer.jdbc.fileSession.reaperIntervalMs";

    private final JdbcDialectDiscovery dialectDiscovery;

    public JdbcBackendPlugin()
    {
        this(new ServiceLoaderJdbcDialectDiscovery());
    }

    JdbcBackendPlugin(JdbcDialectDiscovery dialectDiscovery)
    {
        this.dialectDiscovery = dialectDiscovery;
    }

    @Override
    public PluginDescriptor descriptor()
    {
        return new PluginDescriptor("query.jdbc", "JDBC Query Engine", "0.1.0", List.of(), List.of("queryengine.execute", "queryengine.jdbc.connection"), List.of());
    }

    @Override
    public void activate(BackendPluginContext context)
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        context.logger()
                .info("Registered built-in generic JDBC dialect");
        dialectDiscovery.discoverAndRegister(registry, context.logger());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        long idleTimeoutMs = parseDurationMs(context.config(), IDLE_TIMEOUT_KEY, DEFAULT_IDLE_TIMEOUT_MS);
        long reaperIntervalMs = parseDurationMs(context.config(), REAPER_INTERVAL_KEY, Math.max(1_000L, Math.min(idleTimeoutMs, TimeUnit.MINUTES.toMillis(5))));
        JdbcFileConnectionManager fileConnections = new JdbcFileConnectionManager(idleTimeoutMs);
        JdbcQueryEngineProvider provider = new JdbcQueryEngineProvider(registry, connections, context.secrets(), fileConnections);

        context.scheduler()
                .schedule("jdbc.file-session-reaper", () -> startReaperThread(fileConnections, reaperIntervalMs));

        context.queryEngines()
                .register(provider);
        context.fileSessions()
                .register(provider);
        context.logger()
                .info("Activated jdbc backend plugin");
    }

    private static long parseDurationMs(com.queryeer.backend.api.ConfigService config, String key, long defaultValue)
    {
        String value = config.get(key);
        if (value == null
                || value.isBlank())
        {
            return defaultValue;
        }
        try
        {
            long parsed = Long.parseLong(value.trim());
            return parsed <= 0L ? defaultValue
                    : parsed;
        }
        catch (NumberFormatException e)
        {
            return defaultValue;
        }
    }

    private static void startReaperThread(JdbcFileConnectionManager fileConnections, long intervalMs)
    {
        Thread thread = new Thread(() ->
        {
            while (!Thread.currentThread()
                    .isInterrupted())
            {
                fileConnections.closeIdleConnections(System.currentTimeMillis());
                sleepQuietly(intervalMs);
            }
        }, "jdbc-file-session-reaper");
        thread.setDaemon(true);
        thread.start();
    }

    private static void sleepQuietly(long millis)
    {
        try
        {
            Thread.sleep(Math.max(100L, millis));
        }
        catch (InterruptedException e)
        {
            Thread.currentThread()
                    .interrupt();
        }
    }
}
