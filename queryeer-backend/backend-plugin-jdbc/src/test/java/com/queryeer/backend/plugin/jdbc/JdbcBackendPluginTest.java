package com.queryeer.backend.plugin.jdbc;

import static org.mockito.Mockito.mock;

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
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.PluginServiceRegistry;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SchedulerService;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionSetupDefinition;

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
        Assertions.assertEquals(List.of("engine.capabilities", "jdbc.connection.setup", "jdbc.connection.dialects", "jdbc.connection.test", "jdbc.schema.snapshot", "jdbc.schema.refresh",
                "jdbc.schema.fetch", "jdbc.connection.sessions", "sql.parse.snapshot", "sql.complete", "sql.symbolAtPosition"), map.get("actions"));
    }

    @SuppressWarnings("unchecked")
    @Test
    void schemaRefreshReturnsUpdatedSnapshotWhenSessionOpen() throws Exception
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        RecordingEventBus events = new RecordingEventBus();
        plugin.activate(new TestPluginContext(engines, fileSessions, defaultConnectionsConfigService(), (_, _) ->
        {
        }, events));
        QueryEngineProvider provider = engines.provider;

        String jdbcUrl = "jdbc:h2:mem:test_refresh_open;DB_CLOSE_DELAY=-1";

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
    void schemaSnapshotTopTriggersRefreshWhenCacheIsEmpty() throws Exception
    {
        QueryEngineProvider provider = activateAndGetProvider();
        String jdbcUrl = "jdbc:h2:mem:test_snapshot_backfill;DB_CLOSE_DELAY=-1";

        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table snapshot_visible(id int)");
        }

        List<Object> snapshot = (List<Object>) provider.invoke(null, "jdbc.schema.snapshot", Map.of("connectionId", "jdbc-snapshot-backfill", "scope", "top"));
        Assertions.assertFalse(snapshot.isEmpty());
    }

    @SuppressWarnings("unchecked")
    @Test
    void schemaFetchReturnsTablesDirectlyWithoutDeepCachePersist() throws Exception
    {
        QueryEngineProvider provider = activateAndGetProvider();
        String jdbcUrl = "jdbc:h2:mem:test_fetch_deep_append;DB_CLOSE_DELAY=-1";

        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table fetch_direct_visible(id int)");
        }

        Object fetched = provider.invoke(null, "jdbc.schema.fetch", Map.of("connectionId", "jdbc-fetch-deep", "parentKind", "tables_folder", "target", Map.of("schema", "PUBLIC")));
        Assertions.assertNotNull(fetched);
        List<Object> items = (List<Object>) fetched;
        Assertions.assertTrue(items.stream()
                .map(Object::toString)
                .anyMatch(text -> text.contains("FETCH_DIRECT_VISIBLE")));
    }

    @SuppressWarnings("unchecked")
    @Test
    void schemaFetchWithConnectionParentKindReturnsMutableListForDialectBranchMerge() throws Exception
    {
        // Regression: router.resolve() returns an immutable list, but the action handler
        // must be able to add dialect tree branches to it (e.g. Security container).
        // This test verifies the fetch does not throw UnsupportedOperationException.
        QueryEngineProvider provider = activateAndGetProvider();

        Object fetched = provider.invoke(null, "jdbc.schema.fetch", Map.of("connectionId", "jdbc-fetch-deep", "parentKind", "connection"));
        Assertions.assertNotNull(fetched);
        List<Object> items = (List<Object>) fetched;
        // Must contain at least the databases_container node
        Assertions.assertTrue(items.stream()
                .map(Object::toString)
                .anyMatch(text -> text.contains("databases_container")));
    }

    @SuppressWarnings("unchecked")
    @Test
    void sqlCompleteAcceptsConnectionIdPayload() throws Exception
    {
        QueryEngineProvider provider = activateAndGetProvider();
        String jdbcUrl = "jdbc:h2:mem:test_fetch_deep_append;DB_CLOSE_DELAY=-1";

        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table completion_visible(id int)");
        }

        provider.invoke(null, "jdbc.schema.refresh", Map.of("connectionId", "jdbc-fetch-deep", "scope", "top"));

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", "", "connectionId", "jdbc-fetch-deep", "cursor", Map.of("line", 1, "column", 1), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertFalse(items.isEmpty());
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "SELECT".equals(item.get("label"))));
    }

    @SuppressWarnings("unchecked")
    @Test
    void sqlCompleteIncludesTableNamesViaLiveFallbackWhenDeepCacheIsEmpty() throws Exception
    {
        // Regression: navigator.loadSnapshotForLookup falls through to live query
        // when DEEP cache is empty. The fallback must return tables (and views).
        QueryEngineProvider provider = activateAndGetProvider();
        String jdbcUrl = "jdbc:h2:mem:test_fetch_deep_append;DB_CLOSE_DELAY=-1";

        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table table_complete_test(id int)");
            statement.execute("create view view_complete_test as select * from table_complete_test");
        }

        // Refresh TOP only (DEEP cache remains empty)
        provider.invoke(null, "jdbc.schema.refresh", Map.of("connectionId", "jdbc-fetch-deep", "scope", "top"));

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", "SELECT * FROM ", "connectionId", "jdbc-fetch-deep", "cursor", Map.of("line", 1, "column", 15), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        // Table names from live fallback should be present (table_complete_test, and may include fetch_direct_visible)
        Assertions.assertTrue(items.stream()
                .map(item -> String.valueOf(item.get("label")))
                .anyMatch(label -> label.toUpperCase()
                        .contains("TABLE_COMPLETE_TEST")));
    }

    @SuppressWarnings("unchecked")
    @Test
    void sqlSymbolAtPositionResolvesTableFromSchemaStore() throws Exception
    {
        QueryEngineProvider provider = activateAndGetProvider();
        String jdbcUrl = "jdbc:h2:mem:test_symbol;DB_CLOSE_DELAY=-1";

        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table if not exists symbol_target(id int)");
        }

        provider.invoke(null, "jdbc.schema.refresh", Map.of("connectionId", "jdbc-symbol", "scope", "deep", "target", Map.of("schema", "PUBLIC")));

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.symbolAtPosition",
                Map.of("text", "SELECT * FROM PUBLIC.SYMBOL_TARGET", "cursor", Map.of("line", 1, "column", 22), "connectionId", "jdbc-symbol"));

        Assertions.assertNotNull(result);
        Assertions.assertEquals("table", result.get("kind"));
        Assertions.assertNotNull(result.get("name"));
        Assertions.assertTrue(result.get("name")
                .toString()
                .toUpperCase()
                .contains("SYMBOL_TARGET"));
    }

    @Test
    void sqlSymbolAtPositionReturnsNullWhenTokenNotInSchema() throws Exception
    {
        QueryEngineProvider provider = activateAndGetProvider();

        provider.invoke(null, "jdbc.schema.refresh", Map.of("connectionId", "jdbc-symbol", "scope", "top"));

        Object result = provider.invoke("file-1", "sql.symbolAtPosition",
                Map.of("text", "SELECT * FROM totally_unknown_xyz", "cursor", Map.of("line", 1, "column", 20), "connectionId", "jdbc-symbol"));

        Assertions.assertNull(result);
    }

    @SuppressWarnings("unchecked")
    @Test
    void sqlCompleteWithDatabaseParamReturnsTablesViaLiveFallback() throws Exception
    {
        // Regression: when selectedDatabase is set but no schema, the fallback previously
        // created JdbcSchemaTarget(database, null). target.matches() returns false when
        // schema is null, filtering out ALL tables. Null target must be passed instead.
        QueryEngineProvider provider = activateAndGetProvider();
        String jdbcUrl = "jdbc:h2:mem:test_fetch_deep_append;DB_CLOSE_DELAY=-1";

        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table db_filter_test(id int)");
        }

        // Only TOP refresh (DEEP cache stays empty)
        provider.invoke(null, "jdbc.schema.refresh", Map.of("connectionId", "jdbc-fetch-deep", "scope", "top"));

        // Complete with explicit database parameter — this previously caused ALL tables
        // to be filtered out because the fallback target had schema=null
        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete", Map.of("fileId", "file-1", "version", 1L, "text", "SELECT * FROM ", "connectionId",
                "jdbc-fetch-deep", "database", "TEST", "cursor", Map.of("line", 1, "column", 15), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertTrue(items.stream()
                .map(item -> String.valueOf(item.get("label")))
                .anyMatch(label -> label.toUpperCase()
                        .contains("DB_FILTER_TEST")),
                "Table should appear in completion even when database filter is set, " + items.stream()
                        .map(i -> String.valueOf(i.get("label")))
                        .toList());
    }

    @SuppressWarnings("unchecked")
    @Test
    void sqlSymbolAtPositionResolvesTableViaLiveFallbackWhenDeepCacheEmpty() throws Exception
    {
        // Regression: findSymbol had no live fallback — if DEEP cache was empty,
        // symbol lookup always returned null for all dialects. Now it falls through
        // to live resolve when cache is empty.
        QueryEngineProvider provider = activateAndGetProvider();
        String jdbcUrl = "jdbc:h2:mem:test_fetch_deep_append;DB_CLOSE_DELAY=-1";

        try (Connection connection = DriverManager.getConnection(jdbcUrl); Statement statement = connection.createStatement())
        {
            statement.execute("create table symbol_live_target(id int)");
        }

        // NO refresh at all — DEEP cache empty, TOP cache empty
        // Symbol lookup must still find the table via live fallback
        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.symbolAtPosition",
                Map.of("text", "SELECT * FROM SYMBOL_LIVE_TARGET", "cursor", Map.of("line", 1, "column", 22), "connectionId", "jdbc-fetch-deep"));
        Assertions.assertNotNull(result);
        Assertions.assertEquals("table", result.get("kind"));
        Assertions.assertNotNull(result.get("name"));
        Assertions.assertTrue(result.get("name")
                .toString()
                .toUpperCase()
                .contains("SYMBOL_LIVE_TARGET"));
    }

    @Test
    void executeResolvesPasswordFromSecretRefMapInStoredConnection()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-2", "file-1", "select 1", Map.of("connectionId", "jdbc-secret"), publisher);

        Assertions.assertNull(publisher.errorCode);
        Assertions.assertTrue(publisher.completed);
        Assertions.assertEquals(1L, publisher.rowCount);
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeConnectionTestReturnsOkForValidPayload()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        Object result = provider.invoke("file-1", "jdbc.connection.test", Map.of("connection", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test_connection;DB_CLOSE_DELAY=-1")));

        Assertions.assertInstanceOf(Map.class, result);
        Map<String, Object> map = (Map<String, Object>) result;
        Assertions.assertEquals(Boolean.TRUE, map.get("ok"));
    }

    @Test
    void invokeConnectionTestRejectsUnknownDialect()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class,
                () -> provider.invoke("file-1", "jdbc.connection.test", Map.of("connection", Map.of("dialectId", "oracle", "url", "jdbc:oracle:thin:@localhost:1521/XE"))));

        Assertions.assertEquals("Unsupported JDBC dialect: oracle", error.getMessage());
    }

    @Test
    void executeReturnsValidationFailureWhenUrlMissing()
    {
        QueryEngineProvider provider = activateAndGetProvider();
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-1", "file-1", "select 1", Map.of("connectionId", "bad-url"), publisher);

        Assertions.assertEquals("VALIDATION", publisher.errorCode);
        Assertions.assertEquals("Connection has no url configured: bad-url", publisher.errorMessage);
    }

    @Test
    void cancelBeforeExecuteReturnsCancelledFailure()
    {
        QueryEngineProvider provider = activateAndGetProvider();
        RecordingPublisher publisher = new RecordingPublisher();

        provider.cancel("exec-cancelled");
        provider.execute("exec-cancelled", "file-1", "select 1", Map.of("connectionId", "cancel-conn"), publisher);

        Assertions.assertEquals("CANCELLED", publisher.errorCode);
        Assertions.assertEquals("Execution cancelled by client", publisher.errorMessage);
    }

    @Test
    void executeReusesSessionConnectionWithinFileSessionForTempObjects()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        RecordingPublisher createPublisher = new RecordingPublisher();
        provider.execute("exec-session-1", "file-session", "create local temporary table temp_t(v int)", Map.of("connectionId", "jdbc-session"), createPublisher);
        Assertions.assertNull(createPublisher.errorCode, createPublisher.errorMessage);

        RecordingPublisher insertPublisher = new RecordingPublisher();
        provider.execute("exec-session-1b", "file-session", "insert into temp_t(v) values (42)", Map.of("connectionId", "jdbc-session"), insertPublisher);
        Assertions.assertNull(insertPublisher.errorCode);

        RecordingPublisher selectPublisher = new RecordingPublisher();
        provider.execute("exec-session-2", "file-session", "select v from temp_t", Map.of("connectionId", "jdbc-session"), selectPublisher);

        Assertions.assertNull(selectPublisher.errorCode);
        Assertions.assertTrue(selectPublisher.completed);
        Assertions.assertEquals(1L, selectPublisher.rowCount);
        Assertions.assertFalse(selectPublisher.rows.isEmpty());
        Assertions.assertEquals(42, ((Number) selectPublisher.rows.get(0)
                .get(0)).intValue());
    }

    @Test
    void executeFailureEmitsSessionIdInErrorDetails()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-fail-1", "file-fail", "select * from definitely_missing_table_12345", Map.of("connectionId", "jdbc-session-fail", "sessionId", "my-session-456"), publisher);

        Assertions.assertEquals("INTERNAL", publisher.errorCode);
        Assertions.assertNotNull(publisher.errorDetails);
        Assertions.assertEquals("my-session-456", publisher.errorDetails.get("sessionId"));
    }

    @Test
    void rebindingConnectionClosesPreviousSessionStateImmediately()
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        plugin.activate(new TestPluginContext(engines, fileSessions));
        QueryEngineProvider provider = engines.provider;

        RecordingPublisher createPublisher = new RecordingPublisher();
        provider.execute("exec-rebind-1", "file-rebind", "create local temporary table temp_rebind(v int)", Map.of("connectionId", "jdbc-rebind-a"), createPublisher);
        Assertions.assertNull(createPublisher.errorCode, createPublisher.errorMessage);

        fileSessions.handler.onClose(new com.queryeer.backend.api.FileSession("file-rebind", java.net.URI.create("file:///tmp.sql"), "text/sql", "jdbc", "jdbc-rebind-a", 1L));
        fileSessions.handler.onOpen(new com.queryeer.backend.api.FileSession("file-rebind", java.net.URI.create("file:///tmp.sql"), "text/sql", "jdbc", "jdbc-rebind-b", 2L), null);

        RecordingPublisher oldConnectionPublisher = new RecordingPublisher();
        provider.execute("exec-rebind-2", "file-rebind", "select v from temp_rebind", Map.of("connectionId", "jdbc-rebind-a"), oldConnectionPublisher);
        Assertions.assertEquals("INTERNAL", oldConnectionPublisher.errorCode);

        RecordingPublisher newConnectionPublisher = new RecordingPublisher();
        provider.execute("exec-rebind-3", "file-rebind", "select 1", Map.of("connectionId", "jdbc-rebind-b"), newConnectionPublisher);
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

        RecordingPublisher createPublisher = new RecordingPublisher();
        provider.execute("exec-close-1", "file-close", "create local temporary table temp_close(v int)", Map.of("connectionId", "jdbc-close"), createPublisher);
        Assertions.assertNull(createPublisher.errorCode, createPublisher.errorMessage);

        RecordingPublisher insertPublisher = new RecordingPublisher();
        provider.execute("exec-close-1b", "file-close", "insert into temp_close(v) values (1)", Map.of("connectionId", "jdbc-close"), insertPublisher);
        Assertions.assertNull(insertPublisher.errorCode);

        fileSessions.handler.onClose(new com.queryeer.backend.api.FileSession("file-close", java.net.URI.create("file:///tmp.sql"), "text/sql", "jdbc", "jdbc-close", 1L));

        RecordingPublisher selectPublisher = new RecordingPublisher();
        provider.execute("exec-close-2", "file-close", "select v from temp_close", Map.of("connectionId", "jdbc-close"), selectPublisher);

        Assertions.assertEquals("INTERNAL", selectPublisher.errorCode);
    }

    @Test
    void activateSchedulesJdbcFileSessionReaper()
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        RecordingScheduler scheduler = new RecordingScheduler();

        plugin.activate(new TestPluginContext(engines, fileSessions, _ -> "1000", scheduler));

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
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        ConfigService configService = TestUtils.mockConnections("""
                {
                    "core.queryengine.jdbc.connections": [
                        {
                            "connectionId": "550e8400-e29b-41d4-a716-446655440003",
                            "dialectId": "jdbc",
                            "url": "jdbc:h2:mem:test_preload;DB_CLOSE_DELAY=-1",
                            "enabled": true
                        }
                    ]
                }
                """);
        plugin.activate(new TestPluginContext(engines, fileSessions, configService));
        QueryEngineProvider provider = engines.provider;

        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-preload", "file-1", "select 1", Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440003"), publisher);

        Assertions.assertNull(publisher.errorCode, publisher.errorMessage);
        Assertions.assertTrue(publisher.completed);
    }

    @Test
    void startupSchemaCrawlRunsEvenWhenSecuritySessionClosedForPasswordlessConnections() throws Exception
    {
        Path tempDir = Path.of("target", "test-work", "jdbc-crawl-" + java.util.UUID.randomUUID());
        Path cacheDir = tempDir.resolve("cache");
        ConfigService baseConfigService = TestUtils.mockConnections("""
                {
                    "core.queryengine.jdbc.connections": [
                        {
                            "connectionId": "550e8400-e29b-41d4-a716-446655440003",
                            "dialectId": "jdbc",
                            "url": "jdbc:h2:mem:test_preload;DB_CLOSE_DELAY=-1",
                            "enabled": true
                        }
                    ]
                }
                """);

        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();
        RecordingScheduler scheduler = new RecordingScheduler();
        RecordingEventBus events = new RecordingEventBus();
        plugin.activate(new TestPluginContext(engines, fileSessions, new ConfigService()
        {
            @Override
            public String get(String key)
            {
                if ("queryeer.jdbc.schemaCache.dir".equals(key))
                {
                    return cacheDir.toString();
                }
                return baseConfigService.get(key);
            }

            @Override
            public com.queryeer.backend.api.SettingsModule getModule(String moduleId)
            {
                return baseConfigService.getModule(moduleId);
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return baseConfigService.materializeSecrets(payload);
            }
        }, scheduler, events));

        scheduler.run("jdbc.schema-crawl-startup");

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
                            .contains("550e8400-e29b-41d4-a716-446655440003")))
                    {
                        created = true;
                        break;
                    }
                }
            }
            Thread.sleep(500L);
        }

        Assertions.assertTrue(created, "Expected schema cache to be created even without security.session.opened for passwordless connections");
    }

    @Test
    void executeWithDatabaseSwitchesCatalogAndReflectsItBackInEngineState()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-db-1", "file-1", "select 1", Map.of("connectionId", "jdbc-db", "database", "TEST_DB"), publisher);

        Assertions.assertNull(publisher.errorCode, publisher.errorMessage);
        Assertions.assertTrue(publisher.completed);
        Assertions.assertNotNull(publisher.engineState);
        @SuppressWarnings("unchecked")
        Map<String, Object> es = (Map<String, Object>) publisher.engineState;
        Assertions.assertEquals("TEST_DB", es.get("database"));
    }

    @Test
    void executeWithoutDatabaseReflectsCurrentCatalogInEngineState()
    {
        QueryEngineProvider provider = activateAndGetProvider();

        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-no-db-1", "file-1", "select 1", Map.of("connectionId", "jdbc-no-db"), publisher);

        Assertions.assertNull(publisher.errorCode, publisher.errorMessage);
        Assertions.assertTrue(publisher.completed);
        Assertions.assertNotNull(publisher.engineState);
        @SuppressWarnings("unchecked")
        Map<String, Object> es = (Map<String, Object>) publisher.engineState;
        Assertions.assertEquals("TEST_NO_DB", es.get("database"));
    }

    @Test
    void connectionSessionsReportsAliveAndTransientDeadEntries() throws Exception
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry engines = new RecordingQueryEngineRegistry();
        RecordingFileSessionHandlerRegistry fileSessions = new RecordingFileSessionHandlerRegistry();

        ConfigService configService = defaultConnectionsConfigService();

        plugin.activate(new TestPluginContext(engines, fileSessions, configService));
        QueryEngineProvider provider = engines.provider;

        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-live-1", "file-live", "select 1", Map.of("connectionId", "jdbc-live"), publisher);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> beforeClose = (List<Map<String, Object>>) provider.invoke(null, "jdbc.connection.sessions", null);
        Assertions.assertTrue(beforeClose.stream()
                .anyMatch(entry -> "file-live".equals(entry.get("fileId"))
                        && "alive".equals(entry.get("status"))));

        fileSessions.handler.onClose(new com.queryeer.backend.api.FileSession("file-live", java.net.URI.create("file:///tmp.sql"), "text/sql", "jdbc", "jdbc-live", 1L));

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> afterClose = (List<Map<String, Object>>) provider.invoke(null, "jdbc.connection.sessions", null);
        Assertions.assertTrue(afterClose.stream()
                .anyMatch(entry -> "file-live".equals(entry.get("fileId"))
                        && "dead".equals(entry.get("status"))));
    }

    private QueryEngineProvider activateAndGetProvider()
    {
        JdbcBackendPlugin plugin = new JdbcBackendPlugin();
        RecordingQueryEngineRegistry registry = new RecordingQueryEngineRegistry();
        plugin.activate(new TestPluginContext(registry, new RecordingFileSessionHandlerRegistry(), defaultConnectionsConfigService()));
        return registry.provider;
    }

    private static ConfigService defaultConnectionsConfigService()
    {
        try
        {
            return TestUtils.mockConnections("""
                    {
                        "core.queryengine.jdbc.connections": [
                            {
                                "connectionId": "jdbc-refresh-open",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_refresh_open;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-snapshot-backfill",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_snapshot_backfill;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-fetch-deep",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_fetch_deep_append;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-secret",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_secret;DB_CLOSE_DELAY=-1",
                                "username": "sa",
                                "password": {
                                    "secretRef": "jdbc-pass"
                                },
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-test",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_connection;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "bad-url",
                                "dialectId": "jdbc",
                                "properties": {},
                                "enabled": true
                            },
                            {
                                "connectionId": "cancel-conn",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_cancel;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-session",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_session;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-session-fail",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_session_fail;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-rebind-a",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_rebind_a;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-rebind-b",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_rebind_b;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-close",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_close;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-db",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_db;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-no-db",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_no_db;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-live",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_live;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            },
                            {
                                "connectionId": "jdbc-symbol",
                                "dialectId": "jdbc",
                                "url": "jdbc:h2:mem:test_symbol;DB_CLOSE_DELAY=-1",
                                "enabled": true
                            }
                        ]
                    }
                    """);
        }
        catch (Exception e)
        {
            throw new RuntimeException(e);
        }
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
        private Map<String, Object> errorDetails;
        private boolean completed;
        private long rowCount;
        private Object engineState;
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
        public void completed(long durationMs, long rowCount, Object engineState)
        {
            this.completed = true;
            this.rowCount = rowCount;
            this.engineState = engineState;
        }

        @Override
        public void failed(String errorCode, String errorMessage)
        {
            this.errorCode = errorCode;
            this.errorMessage = errorMessage;
        }

        @Override
        public void failed(String errorCode, String errorMessage, Map<String, Object> details)
        {
            this.errorCode = errorCode;
            this.errorMessage = errorMessage;
            this.errorDetails = details;
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

        @Override
        public void subscribe(String topic, java.util.function.Consumer<Object> listener)
        {
            listenersByTopic.computeIfAbsent(topic, _ -> new java.util.ArrayList<>())
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
        private final PayloadMapper payloadMapper = TestPayloadMapper.INSTANCE;
        private final String cacheDir = Path.of("target", "test-work", "jdbc-schema-cache", java.util.UUID.randomUUID()
                .toString())
                .toString();

        private TestPluginContext(QueryEngineRegistry queryEngineRegistry, FileSessionHandlerRegistry fileSessionHandlerRegistry)
        {
            this(queryEngineRegistry, fileSessionHandlerRegistry, defaultConnectionsConfigService(), (_, _) ->
            {
            }, new RecordingEventBus());
        }

        private TestPluginContext(QueryEngineRegistry queryEngineRegistry, FileSessionHandlerRegistry fileSessionHandlerRegistry, ConfigService configService)
        {
            this(queryEngineRegistry, fileSessionHandlerRegistry, configService, (_, _) ->
            {
            }, new RecordingEventBus());
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
            this.configService = new ConfigService()
            {
                @Override
                public String get(String key)
                {
                    String value = configService.get(key);
                    if (value != null)
                    {
                        return value;
                    }
                    return "queryeer.jdbc.schemaCache.dir".equals(key) ? cacheDir
                            : null;
                }

                @Override
                public com.queryeer.backend.api.SettingsModule getModule(String moduleId)
                {
                    return configService.getModule(moduleId);
                }

                @Override
                public Object materializeSecrets(Object payload)
                {
                    return configService.materializeSecrets(payload);
                }

                @Override
                public void invalidateModule(String moduleId)
                {
                    configService.invalidateModule(moduleId);
                }
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
        public QueryEngineRegistry queryEngines()
        {
            return queryEngineRegistry;
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

        @Override
        public PayloadMapper payloadMapper()
        {
            return payloadMapper;
        }

        @Override
        public PluginServiceRegistry services()
        {
            return mock(PluginServiceRegistry.class);
        }
    }
}
