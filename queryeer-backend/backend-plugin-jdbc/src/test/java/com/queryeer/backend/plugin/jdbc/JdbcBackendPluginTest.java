package com.queryeer.backend.plugin.jdbc;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.EventBus;
import com.queryeer.backend.api.FileSessionHandlerRegistry;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.MetadataRegistry;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SchedulerService;
import com.queryeer.backend.api.SecretService;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionSetupDefinition;

class JdbcBackendPluginTest
{
    @Test
    void invokeConnectionSetupReturnsSimpleFields()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        Object result = provider.invoke("file-1", "jdbc.connection.setup", null);

        Assertions.assertInstanceOf(JdbcConnectionSetupDefinition.class, result);
        JdbcConnectionSetupDefinition setup = (JdbcConnectionSetupDefinition) result;
        Assertions.assertEquals(List.of("dialectId", "url", "username", "password"), setup.fields()
                .stream()
                .map(f -> f.id())
                .toList());
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeCapabilitiesIncludesJdbcActions()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        Object result = provider.invoke("file-1", "engine.capabilities", null);

        Map<String, Object> map = (Map<String, Object>) result;
        Assertions.assertEquals(
                List.of("engine.capabilities", "connection.upsert", "jdbc.connection.setup", "jdbc.connection.dialects", "jdbc.connection.test", "jdbc.schema.snapshot", "jdbc.schema.refresh"),
                map.get("actions"));
    }

    @Test
    void schemaRefreshRequiresOpenSecuritySession()
    {
        QueryEngineProvider provider = activateAndGetProvider();
        provider.invoke(null, "connection.upsert",
                Map.of("connectionId", "jdbc-refresh-closed", "connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_refresh_closed;DB_CLOSE_DELAY=-1")));

        IllegalStateException error = Assertions.assertThrows(IllegalStateException.class,
                () -> provider.invoke(null, "jdbc.schema.refresh", Map.of("connectionId", "jdbc-refresh-closed", "scope", "deep", "target", Map.of("schema", "PUBLIC"))));
        Assertions.assertEquals("security.session.open is required before schema refresh", error.getMessage());
    }

    @Test
    void schemaRefreshDeepRequiresTargetSchema()
    {
        QueryEngineProvider provider = activateAndGetProvider();
        provider.invoke(null, "connection.upsert",
                Map.of("connectionId", "jdbc-refresh-target", "connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_refresh_target;DB_CLOSE_DELAY=-1")));

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class,
                () -> provider.invoke(null, "jdbc.schema.refresh", Map.of("connectionId", "jdbc-refresh-target", "scope", "deep")));
        Assertions.assertEquals("target.schema is required for scope=deep", error.getMessage());
    }

    @SuppressWarnings("unchecked")
    @Test
    void schemaRefreshReturnsUpdatedSnapshotWhenSessionOpen() throws Exception
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        RecordingEventBus events = new RecordingEventBus();
        plugin.activate(new TestPluginContext(engines, fileSessions, key -> "queryeer.jdbc.schemaCache.dir".equals(key) ? Path.of("target", "test-work", "jdbc-schema-cache", "refresh-open")
                .toString()
                : null, (name, task) ->
                {
                }, events));
        QueryEngineProvider provider = engines.provider;

        String jdbcUrl = "jdbc:h2:mem:test_refresh_open;DB_CLOSE_DELAY=-1";
        provider.invoke(null, "connection.upsert", Map.of("connectionId", "jdbc-refresh-open", "connection", Map.of("dialectId", "jdbc", "url", jdbcUrl)));

        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table refresh_visible(id int)");
        }
        events.publish("security.session.opened", Map.of("sessionId", "s1"));

        List<Object> snapshot = (List<Object>) provider.invoke(null, "jdbc.schema.refresh", Map.of("connectionId", "jdbc-refresh-open", "scope", "deep", "target", Map.of("schema", "PUBLIC")));
        Assertions.assertTrue(snapshot.stream()
                .map(Object::toString)
                .anyMatch(text -> text.contains("REFRESH_VISIBLE")));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeConnectionUpsertStoresConnectionForExecution()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        Object upsertResult = provider.invoke(null, "connection.upsert",
                Map.of("connectionId", "jdbc1", "connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_upsert;DB_CLOSE_DELAY=-1")));

        Map<String, Object> upsert = (Map<String, Object>) upsertResult;
        Assertions.assertEquals("jdbc1", upsert.get("connectionId"));
        Assertions.assertEquals(1L, upsert.get("version"));

        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-1", "file-1", "select 1", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc1"))), publisher);

        Assertions.assertNull(publisher.errorCode);
        Assertions.assertTrue(publisher.completed);
        Assertions.assertEquals(1L, publisher.rowCount);
        Assertions.assertFalse(publisher.rows.isEmpty());
    }

    @Test
    void executeResolvesPasswordFromSecretRefMapInStoredConnection()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        provider.invoke(null, "connection.upsert", Map.of("connectionId", "jdbc-secret", "connection",
                Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_secret;DB_CLOSE_DELAY=-1", "username", "sa", "password", Map.of("secretRef", "jdbc-pass"))));

        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-2", "file-1", "select 1", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-secret"))), publisher);

        Assertions.assertNull(publisher.errorCode);
        Assertions.assertTrue(publisher.completed);
        Assertions.assertEquals(1L, publisher.rowCount);
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeConnectionTestReturnsOkForValidPayload()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        Object result = provider.invoke("file-1", "jdbc.connection.test", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_connection;DB_CLOSE_DELAY=-1"));

        Assertions.assertInstanceOf(Map.class, result);
        Map<String, Object> map = (Map<String, Object>) result;
        Assertions.assertEquals(Boolean.TRUE, map.get("ok"));
    }

    @Test
    void invokeConnectionTestRejectsUnknownDialect()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class,
                () -> provider.invoke("file-1", "jdbc.connection.test", Map.of("dialectId", "oracle", "url", "jdbc:oracle:thin:@localhost:1521/XE")));

        Assertions.assertEquals("Unsupported JDBC dialect: oracle", error.getMessage());
    }

    @Test
    void executeReturnsValidationFailureWhenUrlMissing()
    {
        QueryEngineProvider provider = activateAndGetProvider();
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-1", "file-1", "select 1", Map.of("jdbc", Map.of("connection", Map.of("dialectId", "jdbc"))), publisher);

        Assertions.assertEquals("VALIDATION", publisher.errorCode);
        Assertions.assertEquals("JDBC connection url is required", publisher.errorMessage);
    }

    @Test
    void cancelBeforeExecuteReturnsCancelledFailure()
    {
        QueryEngineProvider provider = activateAndGetProvider();
        RecordingPublisher publisher = new RecordingPublisher();

        provider.cancel("exec-cancelled");
        provider.execute("exec-cancelled", "file-1", "select 1", Map.of("jdbc", Map.of("connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_cancel;DB_CLOSE_DELAY=-1"))), publisher);

        Assertions.assertEquals("CANCELLED", publisher.errorCode);
        Assertions.assertEquals("Execution cancelled by client", publisher.errorMessage);
    }

    @Test
    void executeReusesSessionConnectionWithinFileSessionForTempObjects()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        provider.invoke(null, "connection.upsert", Map.of("connectionId", "jdbc-session", "connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_session;DB_CLOSE_DELAY=-1")));

        RecordingPublisher createPublisher = new RecordingPublisher();
        provider.execute("exec-session-1", "file-session", "create local temporary table temp_t(v int)", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-session"))), createPublisher);
        Assertions.assertNull(createPublisher.errorCode, createPublisher.errorMessage);

        RecordingPublisher insertPublisher = new RecordingPublisher();
        provider.execute("exec-session-1b", "file-session", "insert into temp_t(v) values (42)", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-session"))), insertPublisher);
        Assertions.assertNull(insertPublisher.errorCode);

        RecordingPublisher selectPublisher = new RecordingPublisher();
        provider.execute("exec-session-2", "file-session", "select v from temp_t", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-session"))), selectPublisher);

        Assertions.assertNull(selectPublisher.errorCode);
        Assertions.assertTrue(selectPublisher.completed);
        Assertions.assertEquals(1L, selectPublisher.rowCount);
        Assertions.assertFalse(selectPublisher.rows.isEmpty());
        Assertions.assertEquals(42, ((Number) selectPublisher.rows.get(0)
                .get(0)).intValue());
    }

    @Test
    void rebindingConnectionClosesPreviousSessionStateImmediately()
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        plugin.activate(new TestPluginContext(engines, fileSessions));
        QueryEngineProvider provider = engines.provider;

        provider.invoke(null, "connection.upsert", Map.of("connectionId", "jdbc-rebind-a", "connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_rebind_a;DB_CLOSE_DELAY=-1")));
        provider.invoke(null, "connection.upsert", Map.of("connectionId", "jdbc-rebind-b", "connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_rebind_b;DB_CLOSE_DELAY=-1")));

        RecordingPublisher createPublisher = new RecordingPublisher();
        provider.execute("exec-rebind-1", "file-rebind", "create local temporary table temp_rebind(v int)", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-rebind-a"))),
                createPublisher);
        Assertions.assertNull(createPublisher.errorCode, createPublisher.errorMessage);

        fileSessions.handler.onClose(new com.queryeer.backend.api.FileSession("file-rebind", java.net.URI.create("file:///tmp.sql"), "text/sql", "jdbc", "jdbc-rebind-a", 1L));
        fileSessions.handler.onOpen(new com.queryeer.backend.api.FileSession("file-rebind", java.net.URI.create("file:///tmp.sql"), "text/sql", "jdbc", "jdbc-rebind-b", 2L), null);

        RecordingPublisher oldConnectionPublisher = new RecordingPublisher();
        provider.execute("exec-rebind-2", "file-rebind", "select v from temp_rebind", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-rebind-a"))), oldConnectionPublisher);
        Assertions.assertEquals("INTERNAL", oldConnectionPublisher.errorCode);

        RecordingPublisher newConnectionPublisher = new RecordingPublisher();
        provider.execute("exec-rebind-3", "file-rebind", "select 1", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-rebind-b"))), newConnectionPublisher);
        Assertions.assertNull(newConnectionPublisher.errorCode, newConnectionPublisher.errorMessage);
    }

    @Test
    void closeFileSessionDropsSessionScopedObjects()
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        plugin.activate(new TestPluginContext(engines, fileSessions));
        QueryEngineProvider provider = engines.provider;

        provider.invoke(null, "connection.upsert", Map.of("connectionId", "jdbc-close", "connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_close_session;DB_CLOSE_DELAY=-1")));

        RecordingPublisher createPublisher = new RecordingPublisher();
        provider.execute("exec-close-1", "file-close", "create local temporary table temp_close(v int)", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-close"))), createPublisher);
        Assertions.assertNull(createPublisher.errorCode, createPublisher.errorMessage);

        RecordingPublisher insertPublisher = new RecordingPublisher();
        provider.execute("exec-close-1b", "file-close", "insert into temp_close(v) values (1)", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-close"))), insertPublisher);
        Assertions.assertNull(insertPublisher.errorCode);

        fileSessions.handler.onClose(new com.queryeer.backend.api.FileSession("file-close", java.net.URI.create("file:///tmp.sql"), "text/sql", "jdbc", "jdbc-close", 1L));

        RecordingPublisher selectPublisher = new RecordingPublisher();
        provider.execute("exec-close-2", "file-close", "select v from temp_close", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "jdbc-close"))), selectPublisher);

        Assertions.assertEquals("INTERNAL", selectPublisher.errorCode);
    }

    @Test
    void activateSchedulesJdbcFileSessionReaper()
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        RecordingScheduler scheduler = new RecordingScheduler();

        plugin.activate(new TestPluginContext(engines, fileSessions, key -> "1000", scheduler));

        Assertions.assertTrue(scheduler.scheduledNames.contains("jdbc.file-session-reaper"));
        Assertions.assertTrue(scheduler.scheduledNames.contains("jdbc.schema-crawl-startup"));
    }

    @Test
    void activateAlwaysSchedulesSchemaCrawlSubsystem()
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        RecordingScheduler scheduler = new RecordingScheduler();

        plugin.activate(new TestPluginContext(engines, fileSessions, key -> "queryeer.jdbc.schemaCache.dir".equals(key) ? Path.of("target", "test-work", "jdbc-schema-cache", "schedule")
                .toString()
                : null, scheduler));

        Assertions.assertTrue(scheduler.scheduledNames.contains("jdbc.schema-crawl-startup"));
    }

    @Test
    void activateLoadsConfiguredJdbcConnectionsFromSettingsDir(@TempDir Path tempDir) throws Exception
    {
        Path settingsDir = tempDir.resolve("settings");
        Files.createDirectories(settingsDir);
        Path fixturePath = Path.of("..", "..", "protocol-fixtures", "jdbc", "connection-settings.json")
                .normalize();
        Files.copy(fixturePath, settingsDir.resolve("core.queryengine.jdbc.json"));

        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        plugin.activate(new TestPluginContext(engines, fileSessions, key -> "queryeer.settings.dir".equals(key) ? settingsDir.toString()
                : null, (name, task) ->
                {
                }));
        QueryEngineProvider provider = engines.provider;

        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-preload", "file-1", "select 1", Map.of("jdbc", Map.of("connection", Map.of("connectionId", "defaulted"))), publisher);

        Assertions.assertNull(publisher.errorCode, publisher.errorMessage);
        Assertions.assertTrue(publisher.completed);
    }

    @Test
    void startupSchemaCrawlWaitsForSecuritySessionOpen() throws Exception
    {
        Path tempDir = Path.of("target", "test-work", "jdbc-crawl-" + java.util.UUID.randomUUID());
        Path settingsDir = tempDir.resolve("settings");
        Path cacheDir = tempDir.resolve("cache");
        Files.createDirectories(settingsDir);
        Path fixturePath = Path.of("..", "..", "protocol-fixtures", "jdbc", "connection-settings.json")
                .normalize();
        Files.copy(fixturePath, settingsDir.resolve("core.queryengine.jdbc.json"));

        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        RecordingScheduler scheduler = new RecordingScheduler();
        RecordingEventBus events = new RecordingEventBus();
        plugin.activate(new TestPluginContext(engines, fileSessions, key ->
        {
            if ("queryeer.settings.dir".equals(key))
            {
                return settingsDir.toString();
            }
            if ("queryeer.jdbc.schemaCache.dir".equals(key))
            {
                return cacheDir.toString();
            }
            return null;
        }, scheduler, events));

        scheduler.run("jdbc.schema-crawl-startup");
        Thread.sleep(300L);

        if (Files.exists(cacheDir))
        {
            try (java.util.stream.Stream<Path> stream = Files.list(cacheDir))
            {
                Assertions.assertTrue(stream.findAny()
                        .isEmpty());
            }
        }

        events.publish("security.session.opened", Map.of("sessionId", "s1"));

        Instant deadline = Instant.now()
                .plus(Duration.ofSeconds(5));
        boolean created = false;
        while (Instant.now()
                .isBefore(deadline))
        {
            if (Files.exists(cacheDir))
            {
                try (java.util.stream.Stream<Path> stream = Files.list(cacheDir))
                {
                    if (stream.anyMatch(path -> path.getFileName()
                            .toString()
                            .contains("defaulted")))
                    {
                        created = true;
                        break;
                    }
                }
            }
            Thread.sleep(100L);
        }

        Assertions.assertTrue(created, "Expected schema cache to be created only after security.session.opened");
    }

    @SuppressWarnings("unchecked")
    @Test
    void schemaCrawlPausesAfterSecuritySessionClosed() throws Exception
    {
        Path tempDir = Path.of("target", "test-work", "jdbc-crawl-close-" + java.util.UUID.randomUUID());
        Path settingsDir = tempDir.resolve("settings");
        Path cacheDir = tempDir.resolve("cache");
        Files.createDirectories(settingsDir);
        String jdbcUrl = "jdbc:h2:mem:test_pause_crawl;DB_CLOSE_DELAY=-1";
        String settingsJson = """
                {
                  "version": 1,
                  "moduleId": "core.queryengine.jdbc",
                  "updatedAt": "2026-05-01T00:00:00.000Z",
                  "values": {
                    "core.queryengine.jdbc.connections": [
                      {
                        "connectionId": "pause1",
                        "dialectId": "jdbc",
                        "url": "%s",
                        "enabled": true
                      }
                    ]
                  }
                }
                """.formatted(jdbcUrl.replace("\\", "\\\\"));
        Files.writeString(settingsDir.resolve("core.queryengine.jdbc.json"), settingsJson);

        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table baseline(id int)");
        }

        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        RecordingScheduler scheduler = new RecordingScheduler();
        RecordingEventBus events = new RecordingEventBus();
        plugin.activate(new TestPluginContext(engines, fileSessions, key ->
        {
            if ("queryeer.settings.dir".equals(key))
            {
                return settingsDir.toString();
            }
            if ("queryeer.jdbc.schemaCache.dir".equals(key))
            {
                return cacheDir.toString();
            }
            if ("queryeer.jdbc.schemaCrawl.intervalMs".equals(key))
            {
                return "500";
            }
            return null;
        }, scheduler, events));

        scheduler.run("jdbc.schema-crawl-startup");
        events.publish("security.session.opened", Map.of("sessionId", "s1"));

        QueryEngineProvider provider = engines.provider;
        waitUntil(Duration.ofSeconds(5), () ->
        {
            if (!Files.exists(cacheDir))
            {
                return false;
            }
            try (java.util.stream.Stream<Path> stream = Files.list(cacheDir))
            {
                return stream.anyMatch(path -> path.getFileName()
                        .toString()
                        .contains("pause1"));
            }
        });

        events.publish("security.session.closed", Map.of());
        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table after_close(id int)");
        }

        Thread.sleep(1500L);
        List<Object> snapshot = (List<Object>) provider.invoke(null, "jdbc.schema.snapshot", Map.of("connectionId", "pause1"));
        Assertions.assertFalse(snapshot.stream()
                .map(Object::toString)
                .anyMatch(text -> text.contains("after_close")));
    }

    private static void waitUntil(Duration timeout, java.util.concurrent.Callable<Boolean> condition) throws Exception
    {
        Instant deadline = Instant.now()
                .plus(timeout);
        while (Instant.now()
                .isBefore(deadline))
        {
            if (Boolean.TRUE.equals(condition.call()))
            {
                return;
            }
            Thread.sleep(100L);
        }
        Assertions.fail("Condition was not met within timeout " + timeout);
    }

    private QueryEngineProvider activateAndGetProvider()
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry registry = new RecordingQueryEngineRegistry();
        plugin.activate(new TestPluginContext(registry, new RecordingFileSessionHandlerRegistry()));
        return registry.provider;
    }

    private static final class RecordingQueryEngineRegistry implements QueryEngineRegistry
    {
        private QueryEngineProvider provider;

        @Override
        public void register(QueryEngineProvider provider)
        {
            this.provider = provider;
        }

        @Override
        public QueryEngineProvider getProvider(String engineId)
        {
            return provider != null
                    && provider.engineId()
                            .equals(engineId) ? provider
                                    : null;
        }
    }

    private static final class RecordingPublisher implements QueryPublisher
    {
        private String errorCode;
        private String errorMessage;
        private boolean completed;
        private long rowCount;
        private final List<List<Object>> rows = new java.util.ArrayList<>();

        @Override
        public void progress(int percent, String message)
        {
        }

        @Override
        public void resultSetStart(List<String> columnNames, List<String> columnTypes)
        {
        }

        @Override
        public void resultSetRows(List<List<Object>> rows)
        {
            this.rows.addAll(rows);
        }

        @Override
        public void completed(long durationMs, long rowCount)
        {
            this.completed = true;
            this.rowCount = rowCount;
        }

        @Override
        public void completed(long durationMs, long rowCount, Object engineStatePatch)
        {
        }

        @Override
        public void failed(String errorCode, String errorMessage)
        {
            this.errorCode = errorCode;
            this.errorMessage = errorMessage;
        }
    }

    private static final class RecordingFileSessionHandlerRegistry implements FileSessionHandlerRegistry
    {
        private com.queryeer.backend.api.FileSessionHandler handler;

        @Override
        public void register(com.queryeer.backend.api.FileSessionHandler handler)
        {
            this.handler = handler;
        }
    }

    private static final class RecordingScheduler implements SchedulerService
    {
        private final java.util.List<String> scheduledNames = new java.util.ArrayList<>();
        private final java.util.Map<String, Runnable> tasksByName = new java.util.LinkedHashMap<>();

        @Override
        public void schedule(String name, Runnable task)
        {
            this.scheduledNames.add(name);
            this.tasksByName.put(name, task);
        }

        void run(String name)
        {
            Runnable task = tasksByName.get(name);
            if (task != null)
            {
                task.run();
            }
        }
    }

    private static final class RecordingEventBus implements EventBus
    {
        private final java.util.Map<String, java.util.List<java.util.function.Consumer<Object>>> listenersByTopic = new java.util.LinkedHashMap<>();

        @Override
        public void publish(String topic, Object event)
        {
            java.util.List<java.util.function.Consumer<Object>> listeners = listenersByTopic.get(topic);
            if (listeners == null)
            {
                return;
            }
            for (java.util.function.Consumer<Object> listener : List.copyOf(listeners))
            {
                listener.accept(event);
            }
        }

        public void subscribe(String topic, java.util.function.Consumer<Object> listener)
        {
            listenersByTopic.computeIfAbsent(topic, ignored -> new java.util.ArrayList<>())
                    .add(listener);
        }
    }

    private static final class TestPluginContext implements BackendPluginContext
    {
        private final QueryEngineRegistry queryEngineRegistry;
        private final FileSessionHandlerRegistry fileSessionHandlerRegistry;
        private final ConfigService configService;
        private final SchedulerService schedulerService;
        private final EventBus eventBus;
        private final String cacheDir = Path.of("target", "test-work", "jdbc-schema-cache", java.util.UUID.randomUUID()
                .toString())
                .toString();

        private TestPluginContext(QueryEngineRegistry queryEngineRegistry, FileSessionHandlerRegistry fileSessionHandlerRegistry)
        {
            this(queryEngineRegistry, fileSessionHandlerRegistry, defaultConfigService(), (name, task) ->
            {
            }, new RecordingEventBus());
        }

        private static ConfigService defaultConfigService()
        {
            Path cacheDir = Path.of("target", "test-work", "jdbc-schema-cache", java.util.UUID.randomUUID()
                    .toString());
            return key -> "queryeer.jdbc.schemaCache.dir".equals(key) ? cacheDir.toString()
                    : null;
        }

        private TestPluginContext(QueryEngineRegistry queryEngineRegistry, FileSessionHandlerRegistry fileSessionHandlerRegistry, ConfigService configService, SchedulerService schedulerService)
        {
            this(queryEngineRegistry, fileSessionHandlerRegistry, configService, schedulerService, new RecordingEventBus());
        }

        private TestPluginContext(QueryEngineRegistry queryEngineRegistry, FileSessionHandlerRegistry fileSessionHandlerRegistry, ConfigService configService, SchedulerService schedulerService,
                EventBus eventBus)
        {
            this.queryEngineRegistry = queryEngineRegistry;
            this.fileSessionHandlerRegistry = fileSessionHandlerRegistry;
            this.configService = key ->
            {
                String value = configService.get(key);
                if (value != null)
                {
                    return value;
                }
                return "queryeer.jdbc.schemaCache.dir".equals(key) ? cacheDir
                        : null;
            };
            this.schedulerService = schedulerService;
            this.eventBus = eventBus;
        }

        @Override
        public LoggerService logger()
        {
            return new LoggerService()
            {
                @Override
                public void info(String message)
                {
                }

                @Override
                public void warn(String message)
                {
                }

                @Override
                public void error(String message, Throwable error)
                {
                }
            };
        }

        @Override
        public ConfigService config()
        {
            return configService;
        }

        @Override
        public SecretService secrets()
        {
            return key -> "jdbc-pass".equals(key) ? "secret-value".toCharArray()
                    : new char[0];
        }

        @Override
        public QueryEngineRegistry queryEngines()
        {
            return queryEngineRegistry;
        }

        @Override
        public MetadataRegistry metadata()
        {
            return provider ->
            {
            };
        }

        @Override
        public FileSessionHandlerRegistry fileSessions()
        {
            return fileSessionHandlerRegistry;
        }

        @Override
        public EventBus events()
        {
            return eventBus;
        }

        @Override
        public SchedulerService scheduler()
        {
            return schedulerService;
        }
    }
}
