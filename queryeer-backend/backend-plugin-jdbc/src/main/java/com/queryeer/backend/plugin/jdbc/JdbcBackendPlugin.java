package com.queryeer.backend.plugin.jdbc;

import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.queryengine.jdbc.DefaultJdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

public final class JdbcBackendPlugin implements BackendPlugin
{
    private static final long DEFAULT_IDLE_TIMEOUT_MS = TimeUnit.MINUTES.toMillis(30);
    private static final String IDLE_TIMEOUT_KEY = "queryeer.jdbc.fileSession.idleTimeoutMs";
    private static final String REAPER_INTERVAL_KEY = "queryeer.jdbc.fileSession.reaperIntervalMs";
    private static final String SCHEMA_CACHE_DIR_KEY = "queryeer.jdbc.schemaCache.dir";
    private static final String SCHEMA_CRAWL_INTERVAL_KEY = "queryeer.jdbc.schemaCrawl.intervalMs";
    private static final String APP_DIR_KEY = "queryeer.app.dir";
    static final String EVENT_SECURITY_SESSION_OPENED = "security.session.opened";
    static final String EVENT_SECURITY_SESSION_CLOSED = "security.session.closed";

    private JdbcDialectDiscovery dialectDiscovery;

    public JdbcBackendPlugin()
    {
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
        if (dialectDiscovery == null)
        {
            dialectDiscovery = new ServiceLoaderJdbcDialectDiscovery(getClass().getClassLoader());
        }
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        context.logger()
                .info("Registered built-in generic JDBC dialect");
        dialectDiscovery.discoverAndRegister(registry, context.logger());
        JdbcSettingsConnectionSource settingsSource = new JdbcSettingsConnectionSource(context.payloadMapper());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry(context.config(), settingsSource, context.logger());
        JdbcConnectionResolver resolver = new JdbcConnectionResolver();
        JdbcCredentialResolver credentialResolver = new JdbcCredentialResolver(context.config(), context.payloadMapper());
        JdbcSchemaStore schemaStore = new JdbcSchemaStore(resolveSchemaCacheDir(context.config()));
        JdbcSchemaCrawler schemaCrawler = new JdbcSchemaCrawler(registry, resolver, schemaStore, context.logger(), credentialResolver);
        JdbcSecuritySessionState securitySessionState = new JdbcSecuritySessionState();
        JdbcSchemaCrawlCoordinator crawlCoordinator = new JdbcSchemaCrawlCoordinator(connections, schemaCrawler, schemaStore, new JdbcSchemaCrawlPolicy(), context.logger());
        context.events()
                .subscribe(EVENT_SECURITY_SESSION_OPENED, event -> securitySessionState.markOpen());
        context.events()
                .subscribe(EVENT_SECURITY_SESSION_CLOSED, event -> securitySessionState.markClosed());
        long idleTimeoutMs = parseDurationMs(context.config(), IDLE_TIMEOUT_KEY, DEFAULT_IDLE_TIMEOUT_MS);
        long reaperIntervalMs = parseDurationMs(context.config(), REAPER_INTERVAL_KEY, Math.max(1_000L, Math.min(idleTimeoutMs, TimeUnit.MINUTES.toMillis(5))));
        long schemaCrawlIntervalMs = parseDurationMs(context.config(), SCHEMA_CRAWL_INTERVAL_KEY, TimeUnit.MINUTES.toMillis(5));
        JdbcFileConnectionManager fileConnections = new JdbcFileConnectionManager(idleTimeoutMs);
        JdbcQueryEngineProvider provider = new JdbcQueryEngineProvider(registry, connections, fileConnections, crawlCoordinator::onUsage, schemaStore, crawlCoordinator, credentialResolver,
                context.payloadMapper());

        context.scheduler()
                .schedule("jdbc.file-session-reaper", () -> startReaperThread(fileConnections, reaperIntervalMs));
        context.scheduler()
                .schedule("jdbc.schema-crawl-startup", () -> crawlCoordinator.start(schemaCrawlIntervalMs));

        context.queryEngines()
                .register(provider);
        context.fileSessions()
                .register(provider);
        context.logger()
                .info("Activated jdbc backend plugin");
    }

    private static long parseDurationMs(ConfigService config, String key, long defaultValue)
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

    private static Path resolveSchemaCacheDir(ConfigService config)
    {
        String explicit = config.get(SCHEMA_CACHE_DIR_KEY);
        if (explicit != null
                && !explicit.isBlank())
        {
            return Path.of(explicit.trim());
        }
        String appDir = config.get(APP_DIR_KEY);
        if (appDir != null
                && !appDir.isBlank())
        {
            return Path.of(appDir.trim(), "jdbc-schema-cache");
        }
        return Path.of("jdbc-schema-cache");
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
