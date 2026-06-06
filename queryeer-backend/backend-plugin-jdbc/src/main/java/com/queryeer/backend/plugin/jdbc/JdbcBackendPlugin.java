package com.queryeer.backend.plugin.jdbc;

import java.nio.file.Path;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.api.parse.IncrementalParseFunction;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.api.parse.ParseSessionSnapshot;
import com.queryeer.backend.plugin.jdbc.schema.JdbcConnectionHealth;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaCrawlCoordinator;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaCrawlPolicy;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaCrawler;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaRouter;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaStore;
import com.queryeer.backend.queryengine.jdbc.DefaultJdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.DefaultJdbcRuntimeService;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;
import com.queryeer.backend.queryengine.jdbc.JdbcSqlEditorServices;
import com.queryeer.backend.queryengine.sql.parser.TreeSitterSqlParseFunction;

public final class JdbcBackendPlugin implements BackendPlugin
{
    private static final long DEFAULT_IDLE_TIMEOUT_MS = TimeUnit.MINUTES.toMillis(30);
    private static final String IDLE_TIMEOUT_KEY = "queryeer.jdbc.fileSession.idleTimeoutMs";
    private static final String REAPER_INTERVAL_KEY = "queryeer.jdbc.fileSession.reaperIntervalMs";
    private static final String SCHEMA_CACHE_DIR_KEY = "queryeer.jdbc.schemaCache.dir";
    private static final String SCHEMA_CRAWL_INTERVAL_KEY = "queryeer.jdbc.schemaCrawl.intervalMs";
    private static final String APP_DIR_KEY = "queryeer.app.dir";

    public JdbcBackendPlugin()
    {
    }

    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        context.logger()
                .info("Registered built-in generic JDBC dialect");
        DefaultJdbcConnections connections = new DefaultJdbcConnections(context.config(), context.payloadMapper(), registry);
        context.services()
                .register(JdbcRuntimeService.class, new DefaultJdbcRuntimeService(registry, connections));
        JdbcSchemaStore schemaStore = new JdbcSchemaStore(resolveSchemaCacheDir(context.config()), context.payloadMapper());
        DefaultJdbcSchemaResolver defaultResolver = new DefaultJdbcSchemaResolver();
        JdbcSchemaRouter router = new JdbcSchemaRouter(defaultResolver);
        JdbcConnectionHealth connectionHealth = new JdbcConnectionHealth();
        JdbcSchemaCrawler schemaCrawler = new JdbcSchemaCrawler(schemaStore, router);
        JdbcSchemaCrawlCoordinator crawlCoordinator = new JdbcSchemaCrawlCoordinator(connections, schemaCrawler, schemaStore, new JdbcSchemaCrawlPolicy(), context.logger(), connectionHealth);
        long idleTimeoutMs = parseDurationMs(context.config(), IDLE_TIMEOUT_KEY, DEFAULT_IDLE_TIMEOUT_MS);
        long reaperIntervalMs = parseDurationMs(context.config(), REAPER_INTERVAL_KEY, Math.max(1_000L, Math.min(idleTimeoutMs, TimeUnit.MINUTES.toMillis(5))));
        IncrementalParseSessionService parseSessions = context.services()
                .get(IncrementalParseSessionService.class);
        if (parseSessions == null)
        {
            parseSessions = noOpParseSessions();
        }
        JdbcQueryEngineProvider provider = new JdbcQueryEngineProvider(registry, connections, idleTimeoutMs, crawlCoordinator::onUsage, schemaStore, crawlCoordinator, context.payloadMapper(), router,
                connectionHealth, parseSessions, new TreeSitterSqlParseFunction());
        context.services()
                .register(JdbcSqlEditorServices.class, provider.editorServices());

        long schemaCrawlIntervalMs = parseDurationMs(context.config(), SCHEMA_CRAWL_INTERVAL_KEY, TimeUnit.MINUTES.toMillis(5));
        context.scheduler()
                .schedule("jdbc.file-session-reaper", () -> startReaperThread(provider, reaperIntervalMs));
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

    private static void startReaperThread(JdbcQueryEngineProvider provider, long intervalMs)
    {
        Thread thread = new Thread(() ->
        {
            while (!Thread.currentThread()
                    .isInterrupted())
            {
                provider.closeIdleConnections(System.currentTimeMillis());
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

    private static IncrementalParseSessionService noOpParseSessions()
    {
        return new IncrementalParseSessionService()
        {
            @Override
            public ParseSessionSnapshot open(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction)
            {
                return null;
            }

            @Override
            public ParseSessionSnapshot change(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction)
            {
                return null;
            }

            @Override
            public void close(String engineId, String fileId)
            {
            }

            @Override
            public Optional<ParseSessionSnapshot> get(String engineId, String fileId)
            {
                return Optional.empty();
            }
        };
    }
}
