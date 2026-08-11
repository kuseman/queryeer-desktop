package com.queryeer.backend.plugin.payloadbuilder;

import static org.junit.jupiter.api.Assertions.assertNull;

import java.math.BigDecimal;
import java.nio.file.Path;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.api.OutputEvent;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.api.parse.IncrementalParseFunction;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.api.parse.ParseSessionSnapshot;
import com.queryeer.backend.contract.query.QueryLargeValueCell;
import com.queryeer.backend.core.DefaultLargeValueStore;
import com.queryeer.backend.core.JacksonPayloadMapper;
import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderQueryEngineProvider.SessionHolder;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcConnections;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;
import com.queryeer.backend.queryengine.jdbc.JdbcSqlEditorServices;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices;
import com.queryeer.backend.queryengine.sql.parser.TreeSitterSqlParseFunction;

import se.kuseman.payloadbuilder.api.QualifiedName;
import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.catalog.Column;
import se.kuseman.payloadbuilder.api.catalog.DatasourceData;
import se.kuseman.payloadbuilder.api.catalog.FunctionInfo;
import se.kuseman.payloadbuilder.api.catalog.IDatasource;
import se.kuseman.payloadbuilder.api.catalog.Option;
import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
import se.kuseman.payloadbuilder.api.catalog.Schema;
import se.kuseman.payloadbuilder.api.catalog.TableFunctionInfo;
import se.kuseman.payloadbuilder.api.catalog.TableSchema;
import se.kuseman.payloadbuilder.api.execution.Decimal;
import se.kuseman.payloadbuilder.api.execution.EpochDateTime;
import se.kuseman.payloadbuilder.api.execution.EpochDateTimeOffset;
import se.kuseman.payloadbuilder.api.execution.IExecutionContext;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.api.execution.ObjectVector;
import se.kuseman.payloadbuilder.api.execution.TupleIterator;
import se.kuseman.payloadbuilder.api.execution.TupleVector;
import se.kuseman.payloadbuilder.api.execution.UTF8String;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.api.expression.IExpression;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

class PayloadbuilderQueryEngineProviderTest
{
    private static final ConfigService NOOP_CONFIG = _ -> null;
    private static final JdbcRuntimeService JDBCRUNTIMESERVICE = Mockito.mock(JdbcRuntimeService.class);
    private static final JdbcSqlEditorServices JDBC_SQL_EDITOR_SERVICES = Mockito.mock(JdbcSqlEditorServices.class);
    private static final PayloadMapper TEST_MAPPER = new JacksonPayloadMapper();
    private static final IncrementalParseSessionService PARSE_SESSIONS = Mockito.mock(IncrementalParseSessionService.class);
    private static final IncrementalParseFunction PARSE_FUNCTION = Mockito.mock(IncrementalParseFunction.class);

    private static PayloadbuilderQueryEngineProvider createProvider(ConfigService config)
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(config, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        return new PayloadbuilderQueryEngineProvider(config, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeCapabilitiesIncludesCatalogActions()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);

        Object result = provider.invoke("file-1", "engine.capabilities", null);

        Assertions.assertTrue(result instanceof Map);
        Map<?, ?> asMap = (Map<?, ?>) result;
        Assertions.assertEquals(
                Set.of("engine.capabilities", "sql.parse.snapshot", "sql.complete", "sql.hover", "sql.symbolAtPosition", "payloadbuilder.es.listIndices", "payloadbuilder.kafka.listTopics"),
                Set.copyOf((List<String>) asMap.get("actions")));
        Assertions.assertEquals(Set.of("jdbc", "elasticsearch", "kafka", "mongodb", "filesystem", "http"), Set.copyOf((Set<String>) asMap.get("catalogIds")));
    }

    @Test
    void invokeEsListIndicesRequiresEndpoint()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> provider.invoke("file-1", "payloadbuilder.es.listIndices", Map.of("properties", Map.of())));

        Assertions.assertEquals("Connection with id: null could not be found", error.getMessage());
    }

    @Test
    void invokeThrowsForUnsupportedAction()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        assertNull(provider.invoke("file-1", "payloadbuilder.unknown", null));
    }

    @Test
    void executePublishesCompletionWithEngineStatePatch()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        RecordingPublisher publisher = new RecordingPublisher();
        Map<String, Object> engineState = Map.of("payloadbuilder", Map.of("catalogs", Map.of()));

        provider.execute("exec-2", "file-1", "select 1", engineState, publisher);

        Assertions.assertTrue(publisher.completedWithPatchCalled);
        Assertions.assertNull(publisher.errorCode);
    }

    @Test
    void executeWithCatalogConfigurationBuildsRegistryAndInjectsProperties()
    {
        JdbcDialect mockDialect = Mockito.mock(JdbcDialect.class);
        JdbcConnection mockConnection = new JdbcConnection("test-conn", "Test Connection", mockDialect, Map.of("host", "localhost", "port", 5432));
        JdbcRuntimeService mockJdbcRuntime = Mockito.mock(JdbcRuntimeService.class);
        JdbcConnections mockConnections = Mockito.mock(JdbcConnections.class);
        Mockito.when(mockJdbcRuntime.connections())
                .thenReturn(mockConnections);
        Mockito.when(mockConnections.resolve("test-conn"))
                .thenReturn(mockConnection);

        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return new SettingsModule("core.queryengine.jdbc", 1L, "2026-01-01T00:00:00Z", Map.of("connections",
                        List.of(Map.of("id", "test-conn", "dialect", "PostgreSQL", "host", "localhost", "port", 5432, "database", "testdb", "username", "user", "password", "pass"))));
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return null;
            }
        };
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(config, TEST_MAPPER, mockJdbcRuntime, JDBC_SQL_EDITOR_SERVICES);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(config, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        RecordingPublisher publisher = new RecordingPublisher();
        Map<String, Object> engineState = Map.of("payloadbuilder", Map.of("catalogs", Map.of("myjdbc", Map.of("catalogId", "jdbc", "properties", Map.of("connectionId", "test-conn")))));

        provider.execute("exec-catalog", "file-catalog", "select 1", engineState, publisher);

        Assertions.assertTrue(publisher.completed
                || publisher.errorCode != null, "Expected either completed or error: " + publisher.errorCode + " - " + publisher.errorMessage);
    }

    @Test
    void executeReturnsValidationFailureForMalformedEngineState()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        RecordingPublisher publisher = new RecordingPublisher();
        Map<String, Object> malformed = Map.of("payloadbuilder", Map.of("catalogs", Map.of("jdbc1", "bad")));

        provider.execute("exec-1", "file-1", "select 1", malformed, publisher);

        Assertions.assertEquals("VALIDATION", publisher.errorCode);
        Assertions.assertTrue(publisher.errorMessage.contains("jdbc1"));
        Assertions.assertFalse(publisher.completed);
    }

    @Test
    void executeRebuildsSessionWhenCatalogSelectionChanges()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new AliasEchoCatalogProvider());
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        ChunkRowsPublisher first = new ChunkRowsPublisher();
        provider.execute("exec-alias-first", "file-alias", "select alias from items", aliasEchoEngineState("first"), first);

        Assertions.assertNull(first.errorCode, first.errorMessage);
        Assertions.assertEquals("first", first.rows.get(0)
                .get(0));

        ChunkRowsPublisher second = new ChunkRowsPublisher();
        provider.execute("exec-alias-second", "file-alias", "select alias from items", aliasEchoEngineState("second"), second);

        Assertions.assertNull(second.errorCode, second.errorMessage);
        Assertions.assertEquals("second", second.rows.get(0)
                .get(0));
    }

    @Test
    void executePreservesSessionAndTempTablesWhenCatalogPropertiesChange()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new PropertyEchoCatalogProvider());
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        RecordingPublisher create = new RecordingPublisher();
        provider.execute("exec-temp-create", "file-temp", "select value into #cached from items", propertyEchoEngineState(Map.of("value", "alpha")), create);

        Assertions.assertNull(create.errorCode, create.errorMessage);
        String sessionId = sessionId(create.engineState);

        ChunkRowsPublisher read = new ChunkRowsPublisher();
        provider.execute("exec-temp-read", "file-temp", "select value from #cached", propertyEchoEngineState(Map.of("value", "beta")), read);

        Assertions.assertNull(read.errorCode, read.errorMessage);
        Assertions.assertEquals(sessionId, sessionId(read.engineState));
        Assertions.assertEquals("alpha", read.rows.get(0)
                .get(0));
    }

    @Test
    void executeReusesSessionAndAppliesNewConnectionState()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new PropertyEchoCatalogProvider());
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        RecordingPublisher first = new RecordingPublisher();
        provider.execute("exec-connection-first", "file-connection", "select value into #cached from items", propertyEchoEngineState(Map.of("connectionId", "first", "value", "alpha")), first);

        ChunkRowsPublisher second = new ChunkRowsPublisher();
        provider.execute("exec-connection-second", "file-connection", "select value from items", propertyEchoEngineState(Map.of("connectionId", "second", "value", "beta")), second);

        Assertions.assertNull(first.errorCode, first.errorMessage);
        Assertions.assertNull(second.errorCode, second.errorMessage);
        Assertions.assertEquals(sessionId(first.engineState), sessionId(second.engineState));
        Assertions.assertEquals("beta", second.rows.get(0)
                .get(0));
    }

    @Test
    void executeSerializesConcurrentQueriesForSameFile() throws Exception
    {
        BlockingPropertyEchoCatalog catalog = new BlockingPropertyEchoCatalog();
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new BlockingPropertyEchoCatalogProvider(catalog));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        try (var executor = Executors.newFixedThreadPool(2))
        {
            ChunkRowsPublisher first = new ChunkRowsPublisher();
            ChunkRowsPublisher second = new ChunkRowsPublisher();
            var firstFuture = executor.submit(() -> provider.execute("exec-concurrent-first", "file-concurrent", "select value from items", propertyEchoEngineState(Map.of("value", "alpha")), first));
            Assertions.assertTrue(catalog.firstEntered.await(5, TimeUnit.SECONDS));

            var secondFuture = executor
                    .submit(() -> provider.execute("exec-concurrent-second", "file-concurrent", "select value from items", propertyEchoEngineState(Map.of("value", "beta")), second));
            Assertions.assertFalse(catalog.secondEntered.await(200, TimeUnit.MILLISECONDS));
            catalog.releaseFirst.countDown();

            firstFuture.get(5, TimeUnit.SECONDS);
            secondFuture.get(5, TimeUnit.SECONDS);
            Assertions.assertEquals(1, catalog.maxActive.get());
            Assertions.assertEquals("alpha", first.rows.get(0)
                    .get(0));
            Assertions.assertEquals("beta", second.rows.get(0)
                    .get(0));
        }
    }

    @Test
    void executeClearsSubmittedCatalogInputPropertiesBetweenRuns()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new PropertyEchoCatalogProvider());
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        ChunkRowsPublisher first = new ChunkRowsPublisher();
        provider.execute("exec-property-first", "file-property-clear", "select value from items", propertyEchoEngineState(Map.of("value", "alpha")), first);

        Assertions.assertNull(first.errorCode, first.errorMessage);
        Assertions.assertEquals("alpha", first.rows.get(0)
                .get(0));

        ChunkRowsPublisher second = new ChunkRowsPublisher();
        provider.execute("exec-property-second", "file-property-clear", "select value from items", propertyEchoEngineState(Map.of()), second);

        Assertions.assertNull(second.errorCode, second.errorMessage);
        Assertions.assertEquals(sessionId(first.engineState), sessionId(second.engineState));
        Assertions.assertNull(second.rows.get(0)
                .get(0));
    }

    @Test
    void executeClearsCatalogTranslatedPropertiesBetweenRuns()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TranslatedPropertyEchoCatalogProvider());
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        ChunkRowsPublisher first = new ChunkRowsPublisher();
        provider.execute("exec-translated-first", "file-translated-clear", "select value from items", propertyEchoEngineState(Map.of("inputValue", "alpha")), first);

        Assertions.assertNull(first.errorCode, first.errorMessage);
        Assertions.assertEquals("alpha", first.rows.get(0)
                .get(0));

        ChunkRowsPublisher second = new ChunkRowsPublisher();
        provider.execute("exec-translated-second", "file-translated-clear", "select value from items", propertyEchoEngineState(Map.of()), second);

        Assertions.assertNull(second.errorCode, second.errorMessage);
        Assertions.assertEquals(sessionId(first.engineState), sessionId(second.engineState));
        Assertions.assertNull(second.rows.get(0)
                .get(0));
    }

    @Test
    void executeSwitchesEnvironmentVariablesBetweenRuns()
    {
        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return new SettingsModule("core.queryengine.payloadbuilder.environments", 1L, "2026-01-01T00:00:00Z",
                        Map.of("core.queryengine.payloadbuilder.environments.values", List.of(Map.of("id", "dev", "title", "Dev", "variables", List.of(Map.of("key", "tenant", "value", "alpha"))),
                                Map.of("id", "prod", "title", "Prod", "variables", List.of(Map.of("key", "tenant", "value", "beta"))))));
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return null;
            }
        };
        PayloadbuilderQueryEngineProvider provider = createProvider(config);

        ChunkRowsPublisher dev = new ChunkRowsPublisher();
        provider.execute("exec-env-dev", "file-env-switch", "select @tenant tenant", Map.of("payloadbuilder", Map.of("selectedEnvironmentId", "dev")), dev);

        Assertions.assertNull(dev.errorCode, dev.errorMessage);
        Assertions.assertEquals("alpha", dev.rows.get(0)
                .get(0));
        String devSessionId = sessionId(dev.engineState);

        ChunkRowsPublisher prod = new ChunkRowsPublisher();
        provider.execute("exec-env-prod", "file-env-switch", "select @tenant tenant", Map.of("payloadbuilder", Map.of("selectedEnvironmentId", "prod")), prod);

        Assertions.assertNull(prod.errorCode, prod.errorMessage);
        Assertions.assertEquals("beta", prod.rows.get(0)
                .get(0));
        Assertions.assertEquals(devSessionId, sessionId(prod.engineState));
    }

    @Test
    void executeIncludesExceptionTypeInFailureMessage()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        RecordingPublisher publisher = new RecordingPublisher();
        Map<String, Object> engineState = Map.of("payloadbuilder", Map.of("catalogs", Map.of()));

        provider.execute("exec-3", "file-1", "select from", engineState, publisher);

        Assertions.assertEquals("VALIDATION", publisher.errorCode);
        Assertions.assertNotNull(publisher.errorMessage);
        Assertions.assertTrue(publisher.errorDetails.containsKey("line"));
        Assertions.assertTrue(publisher.errorDetails.containsKey("column"));
    }

    @Test
    void executeResolvesEnvironmentVariablesFromSettingsModule()
    {
        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return new SettingsModule("core.queryengine.payloadbuilder.environments", 1L, "2026-01-01T00:00:00Z", Map.of("core.queryengine.payloadbuilder.environments.values",
                        List.of(Map.of("id", "test", "title", "Test", "variables", List.of(Map.of("key", "tenant", "value", "acme"), Map.of("key", "apiKey", "secretRef", "s-1"))))));
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return Map.of("secret", "plain-secret");
            }
        };
        PayloadbuilderQueryEngineProvider provider = createProvider(config);
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-env", "file-1", "select 1", Map.of("payloadbuilder", Map.of("selectedEnvironmentId", "test")), publisher);

        Assertions.assertNull(publisher.errorCode);
        Assertions.assertTrue(publisher.completed);
    }

    @Test
    void executeThrowsSecuritySessionClosedWhenVaultIsLocked()
    {
        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return new SettingsModule("core.queryengine.payloadbuilder.environments", 1L, "2026-01-01T00:00:00Z", Map.of("core.queryengine.payloadbuilder.environments.values",
                        List.of(Map.of("id", "test", "title", "Test", "variables", List.of(Map.of("key", "apiKey", "secretRef", "s-1"))))));
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                throw new SecuritySessionClosedException("Security session is not open");
            }
        };
        PayloadbuilderQueryEngineProvider provider = createProvider(config);
        RecordingPublisher publisher = new RecordingPublisher();

        SecuritySessionClosedException error = Assertions.assertThrows(SecuritySessionClosedException.class,
                () -> provider.execute("exec-env", "file-1", "select 1", Map.of("payloadbuilder", Map.of("selectedEnvironmentId", "test")), publisher));

        Assertions.assertEquals("Security session is not open", error.getMessage());
    }

    @Test
    void executeWithPrintStatementPublishesMessages()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        MessageCapturingPublisher publisher = new MessageCapturingPublisher();
        Map<String, Object> engineState = Map.of("payloadbuilder", Map.of("catalogs", Map.of()));

        provider.execute("exec-print", "file-print", "PRINT 'Hello World'", engineState, publisher);

        Assertions.assertTrue(publisher.completed);
        Assertions.assertFalse(publisher.capturedMessages.isEmpty(), "Expected at least one message from PRINT statement");
        boolean foundHello = publisher.capturedMessages.stream()
                .anyMatch(e -> e.message()
                        .contains("Hello World"));
        Assertions.assertTrue(foundHello, "Expected message to contain 'Hello World'");
    }

    @Test
    void executeWithMultiplePrintStatementsPublishesMessages()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        MessageCapturingPublisher publisher = new MessageCapturingPublisher();
        Map<String, Object> engineState = Map.of("payloadbuilder", Map.of("catalogs", Map.of()));

        provider.execute("exec-print-multi", "file-print-multi", "PRINT 'First'; PRINT 'Second'; SELECT 1", engineState, publisher);

        Assertions.assertTrue(publisher.completed);
        Assertions.assertEquals(2, publisher.capturedMessages.size());
        Assertions.assertTrue(publisher.capturedMessages.get(0)
                .message()
                .contains("First"));
        Assertions.assertTrue(publisher.capturedMessages.get(1)
                .message()
                .contains("Second"));
    }

    @Test
    void executeWithSelectAndPrintPublishesMessagesAlongsideResults()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        MessageCapturingPublisher publisher = new MessageCapturingPublisher();
        Map<String, Object> engineState = Map.of("payloadbuilder", Map.of("catalogs", Map.of()));

        provider.execute("exec-print-select", "file-print-select", "PRINT 'before'; SELECT 1 as value; PRINT 'after'", engineState, publisher);

        Assertions.assertTrue(publisher.completed);
        Assertions.assertEquals(2, publisher.capturedMessages.size());
        Assertions.assertTrue(publisher.capturedMessages.get(0)
                .message()
                .contains("before"));
        Assertions.assertTrue(publisher.capturedMessages.get(1)
                .message()
                .contains("after"));
    }

    @Test
    void publishTupleVectorInChunksSplitsRowsIntoMultipleNotifications()
    {
        ChunkRecordingPublisher publisher = new ChunkRecordingPublisher();
        TupleVector tupleVector = TupleVector.of(Schema.of(Column.of("value", ResolvedType.INT)), ValueVector.range(1, 251));

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        Assertions.assertEquals(250, publishedRows);
        Assertions.assertEquals(List.of(100, 100, 50), publisher.chunkSizes);
    }

    @Test
    void publishTupleVectorInChunksConvertsComplexTypesToJsonText()
    {
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();

        TupleVector objectTuple = TupleVector.of(Schema.of(Column.of("objectField", ResolvedType.INT), Column.of("objectText", ResolvedType.STRING)), ValueVector.literalInt(42, 1),
                ValueVector.literalString("obj", 1));

        ValueVector objectVector = ValueVector.literalObject(ObjectVector.wrap(objectTuple), 1);

        TupleVector nestedTable = TupleVector.of(Schema.of(Column.of("nestedId", ResolvedType.INT), Column.of("nestedText", ResolvedType.STRING)), ValueVector.range(10, 12),
                ValueVector.literalString("n", 2));

        ValueVector arrayVector = ValueVector.literalArray(ValueVector.range(1, 4), 1);
        ValueVector tableVector = ValueVector.literalTable(nestedTable, 1);
        ValueVector nullString = ValueVector.literalNull(ResolvedType.STRING, 1);

        TupleVector tupleVector = TupleVector.of(Schema.of(Column.of("arr", ResolvedType.array(ResolvedType.INT)), Column.of("obj", ResolvedType.object(objectTuple.getSchema())),
                Column.of("tbl", ResolvedType.table(nestedTable.getSchema())), Column.of("nullable", ResolvedType.STRING)), arrayVector, objectVector, tableVector, nullString);

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        Assertions.assertEquals(1, publishedRows);
        Assertions.assertNotNull(publisher.rows);
        Assertions.assertEquals(1, publisher.rows.size());

        List<Object> row = publisher.rows.get(0);
        Assertions.assertEquals("[1,2,3]", row.get(0));
        Assertions.assertEquals("{\"objectField\":42,\"objectText\":\"obj\"}", row.get(1));
        Assertions.assertEquals("[{\"nestedId\":10,\"nestedText\":\"n\"},{\"nestedId\":11,\"nestedText\":\"n\"}]", row.get(2));
        Assertions.assertNull(row.get(3));
    }

    @Test
    void publishTupleVectorInChunksSpillsLargeComplexCells(@org.junit.jupiter.api.io.TempDir Path tempDir) throws Exception
    {
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        DefaultLargeValueStore store = new DefaultLargeValueStore(tempDir, 12, 7);
        store.registerExecution("exec-large", "file-large");

        TupleVector objectTuple = TupleVector.of(Schema.of(Column.of("objectText", ResolvedType.STRING)), ValueVector.literalString("abcdef", 1));
        ValueVector objectVector = ValueVector.literalObject(ObjectVector.wrap(objectTuple), 1);
        TupleVector tupleVector = TupleVector.of(Schema.of(Column.of("obj", ResolvedType.object(objectTuple.getSchema()))), objectVector);

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100, store, "exec-large");

        Assertions.assertEquals(1, publishedRows);
        Object cell = publisher.rows.get(0)
                .get(0);
        Assertions.assertTrue(cell instanceof QueryLargeValueCell);
        QueryLargeValueCell large = (QueryLargeValueCell) cell;
        Assertions.assertEquals("json", large.logicalType());
        Assertions.assertEquals("{\"objec", large.preview());
        Assertions.assertEquals("{\"objectText\":\"abcdef\"}", store.read(large.ref())
                .content());
    }

    @Test
    void publishTupleVectorInChunksConvertsNonComplexRuntimeTypesToSerializableValues()
    {
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();

        ValueVector decimal = ValueVector.literalDecimal(Decimal.from("123.45"), 1);
        ValueVector dateTime = ValueVector.literalDateTime(EpochDateTime.from("2025-01-02T03:04:05"), 1);
        ValueVector dateTimeOffset = ValueVector.literalDateTimeOffset(EpochDateTimeOffset.from("2025-01-02T03:04:05Z"), 1);
        ValueVector utf8string = ValueVector.literalString("hello", 1);

        //@formatter:off
        TupleVector tupleVector = TupleVector.of(
                Schema.of(
                       Column.of("d", ResolvedType.DECIMAL),
                       Column.of("dt", ResolvedType.of(Column.Type.DateTime)),
                       Column.of("dto", ResolvedType.of(Column.Type.DateTimeOffset)),
                       Column.of("s", ResolvedType.of(Column.Type.String))
                ),
                decimal,
                dateTime,
                dateTimeOffset,
                utf8string);
        //@formatter:on

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        Assertions.assertEquals(1, publishedRows);
        Assertions.assertNotNull(publisher.rows);
        List<Object> row = publisher.rows.get(0);
        Assertions.assertEquals(new BigDecimal("123.45"), row.get(0));
        Assertions.assertEquals(LocalDateTime.parse("2025-01-02T03:04:05"), row.get(1));
        Assertions.assertEquals(ZonedDateTime.parse("2025-01-02T03:04:05Z"), row.get(2));
        Assertions.assertEquals("hello", row.get(3));
    }

    @Test
    void publishTupleVectorInChunksConvertsAnyRuntimeWrappersToSerializableValues()
    {
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();

        ValueVector anyDecimal = ValueVector.literalAny(1, Decimal.from("77.01"));
        ValueVector anyDateTime = ValueVector.literalAny(1, EpochDateTime.from("2025-01-02T03:04:05"));
        ValueVector anyDateTimeOffset = ValueVector.literalAny(1, EpochDateTimeOffset.from("2025-01-02T03:04:05Z"));
        ValueVector utf8string = ValueVector.literalString("hello", 1);

        //@formatter:off
        TupleVector tupleVector = TupleVector.of(
                Schema.of(
                    Column.of("d", ResolvedType.ANY),
                    Column.of("dt", ResolvedType.ANY),
                    Column.of("dto", ResolvedType.ANY),
                    Column.of("s", ResolvedType.ANY)
                ), anyDecimal,
                anyDateTime,
                anyDateTimeOffset,
                utf8string);
        //@formatter:on

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        Assertions.assertEquals(1, publishedRows);
        Assertions.assertNotNull(publisher.rows);
        List<Object> row = publisher.rows.get(0);
        Assertions.assertEquals(new BigDecimal("77.01"), row.get(0));
        Assertions.assertFalse(row.get(0) instanceof Decimal);
        Assertions.assertEquals(LocalDateTime.parse("2025-01-02T03:04:05"), row.get(1));
        Assertions.assertEquals(ZonedDateTime.parse("2025-01-02T03:04:05Z"), row.get(2));
        Assertions.assertEquals("hello", row.get(3));
    }

    @Test
    void publishTupleVectorInChunksNormalizesPayloadbuilderInternalTypesAtAnyDepth()
    {
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();

        UTF8String utf8 = UTF8String.from("hello");
        Decimal decimal = Decimal.from("3.14");
        EpochDateTime dateTime = EpochDateTime.from("2025-01-02T03:04:05");
        EpochDateTimeOffset dateTimeOffset = EpochDateTimeOffset.from("2025-01-02T03:04:05Z");

        ValueVector topLevelUtf8 = ValueVector.literalAny(1, utf8);
        ValueVector nestedInMap = ValueVector.literalAny(1, Map.of("k", utf8));
        ValueVector nestedInList = ValueVector.literalAny(1, List.of(decimal, dateTime, dateTimeOffset));

        //@formatter:off
        TupleVector tupleVector = TupleVector.of(
                Schema.of(
                    Column.of("top", ResolvedType.ANY),
                    Column.of("inMap", ResolvedType.ANY),
                    Column.of("inList", ResolvedType.ANY)
                ),
                topLevelUtf8,
                nestedInMap,
                nestedInList);
        //@formatter:on

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        Assertions.assertEquals(1, publishedRows);
        Assertions.assertNotNull(publisher.rows);
        List<Object> row = publisher.rows.get(0);

        Assertions.assertEquals("hello", row.get(0));
        Assertions.assertFalse(row.get(0) instanceof UTF8String);

        Assertions.assertEquals("{\"k\":\"hello\"}", row.get(1));
        Assertions.assertEquals("[3.14,\"2025-01-02T03:04:05\",\"2025-01-02T03:04:05Z\"]", row.get(2));
    }

    @Test
    void publishTupleVectorInChunksReturnsZeroForNullVector()
    {
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, null, 100);

        Assertions.assertEquals(0, publishedRows);
        Assertions.assertNull(publisher.rows);
    }

    @Test
    void publishTupleVectorInChunksReturnsZeroForEmptyVector()
    {
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        TupleVector empty = TupleVector.of(Schema.of(Column.of("i", ResolvedType.INT)), ValueVector.literalInt(0, 0));

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, empty, 100);

        Assertions.assertEquals(0, publishedRows);
        Assertions.assertNull(publisher.rows);
    }

    @Test
    void publishTupleVectorInChunksClampsChunkSizeBelowOne()
    {
        ChunkRecordingPublisher publisher = new ChunkRecordingPublisher();
        TupleVector tupleVector = TupleVector.of(Schema.of(Column.of("value", ResolvedType.INT)), ValueVector.range(1, 4));

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 0);

        Assertions.assertEquals(3, publishedRows);
        Assertions.assertEquals(List.of(1, 1, 1), publisher.chunkSizes);
    }

    @Test
    void publishTupleVectorInChunksFlushesPartialFinalBatch()
    {
        ChunkRecordingPublisher publisher = new ChunkRecordingPublisher();
        TupleVector tupleVector = TupleVector.of(Schema.of(Column.of("value", ResolvedType.INT)), ValueVector.range(1, 8));

        int publishedRows = PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 3);

        Assertions.assertEquals(7, publishedRows);
        Assertions.assertEquals(List.of(3, 3, 1), publisher.chunkSizes);
    }

    @Test
    void rowValueAsSerializableObjectReturnsNullForNullCell()
    {
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        TupleVector tupleVector = TupleVector.of(Schema.of(Column.of("nullable", ResolvedType.STRING)), ValueVector.literalNull(ResolvedType.STRING, 1));

        PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        List<Object> row = publisher.rows.get(0);
        Assertions.assertNull(row.get(0));
    }

    @Test
    void rowValueAsSerializableObjectConvertsAllPrimitiveColumnTypes()
    {
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        //@formatter:off
        TupleVector tupleVector = TupleVector.of(
                Schema.of(
                    Column.of("bool", ResolvedType.BOOLEAN),
                    Column.of("i", ResolvedType.INT),
                    Column.of("l", ResolvedType.LONG),
                    Column.of("f", ResolvedType.FLOAT),
                    Column.of("d", ResolvedType.DOUBLE)
                ),
                ValueVector.literalBoolean(true, 1),
                ValueVector.literalInt(42, 1),
                ValueVector.literalLong(9_000_000_000L, 1),
                ValueVector.literalFloat(1.5f, 1),
                ValueVector.literalDouble(2.5, 1));
        //@formatter:on

        PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        List<Object> row = publisher.rows.get(0);
        Assertions.assertEquals(true, row.get(0));
        Assertions.assertEquals(42, row.get(1));
        Assertions.assertEquals(9_000_000_000L, row.get(2));
        Assertions.assertEquals(1.5f, row.get(3));
        Assertions.assertEquals(2.5, row.get(4));
    }

    @Test
    void invokeSqlParseSnapshotReturnsEmptyForBlankFileId()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);

        Object result = provider.invoke("", "sql.parse.snapshot", null);

        Assertions.assertEquals(Map.of(), result);
    }

    @Test
    void invokeSqlParseSnapshotReturnsEmptyWhenNoSnapshot()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);

        Object result = provider.invoke("file-without-snapshot", "sql.parse.snapshot", null);

        Assertions.assertEquals(Map.of(), result);
    }

    @Test
    void invokeSqlParseSnapshotDelegatesToParseSessionService()
    {
        ParseSessionSnapshot snapshot = new ParseSessionSnapshot("payloadbuilder", "file-1", 7L, "sql", true, null, Map.of("k", "v"));
        IncrementalParseSessionService sessions = Mockito.mock(IncrementalParseSessionService.class);
        Mockito.when(sessions.get("payloadbuilder", "file-1"))
                .thenReturn(Optional.of(snapshot));
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, sessions, PARSE_FUNCTION);

        Object result = provider.invoke("file-1", "sql.parse.snapshot", null);

        @SuppressWarnings("unchecked")
        Map<String, Object> map = (Map<String, Object>) result;
        Assertions.assertEquals(7L, map.get("version"));
        Assertions.assertEquals("sql", map.get("languageId"));
        Assertions.assertEquals(true, map.get("hasErrors"));
        Assertions.assertEquals(Map.of("k", "v"), map.get("attributes"));
    }

    @Test
    void invokeSqlCompleteDelegatesToSqlCompletionSupport()
    {
        IncrementalParseSessionService sessions = Mockito.mock(IncrementalParseSessionService.class);
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, sessions, PARSE_FUNCTION);

        Object result = provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", "SELECT ", "cursor", Map.of("line", 1, "column", 8), "limits", Map.of("maxItems", 50)));

        Assertions.assertNotNull(result);
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteIncludesOptedInPayloadbuilderCatalogTables()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", "SELECT * FROM ", "engineState", semanticEngineState(), "cursor", Map.of("line", 1, "column", 15), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "products".equals(item.get("label"))
                        && "table".equals(item.get("kind"))));
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "products_by_category".equals(item.get("label"))
                        && "function".equals(item.get("kind"))));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteQuotesInvalidQualifiedTableNameParts()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", "SELECT * FROM ", "engineState", semanticEngineState(), "cursor", Map.of("line", 1, "column", 15), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Map<String, Object> item = items.stream()
                .filter(candidate -> "sales.order-items".equals(candidate.get("label")))
                .findFirst()
                .orElseThrow();
        Assertions.assertEquals("sales.\"order-items\"", item.get("insertText"));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteIncludesOptedInPayloadbuilderCatalogColumns()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete", Map.of("fileId", "file-1", "version", 1L, "text", "SELECT p. FROM products p", "engineState",
                semanticEngineState(), "cursor", Map.of("line", 1, "column", 10), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "p.id".equals(item.get("label"))
                        && "column".equals(item.get("kind"))));
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "p.external-id".equals(item.get("label"))
                        && "p.\"external-id\"".equals(item.get("insertText"))));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteUsesExplicitCatalogPrefixForSystemTableCatalogTables()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        String text = "SELECT * FROM sem#pro";

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete", Map.of("fileId", "file-1", "version", 1L, "text", text, "engineState",
                semanticEngineStateWithoutDefault(), "cursor", Map.of("line", 1, "column", text.length() + 1), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Map<String, Object> product = items.stream()
                .filter(item -> "products".equals(item.get("label")))
                .findFirst()
                .orElseThrow();
        Assertions.assertEquals("products", product.get("insertText"));
        Map<String, Object> replaceRange = (Map<String, Object>) product.get("replaceRange");
        Assertions.assertEquals(text.indexOf("pro") + 1, replaceRange.get("startColumn"));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteUsesExplicitCatalogPrefixForSystemTableCatalogColumns()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        String text = "SELECT * FROM sem#products p WHERE p.";

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete", Map.of("fileId", "file-1", "version", 1L, "text", text, "engineState",
                semanticEngineStateWithoutDefault(), "cursor", Map.of("line", 1, "column", text.length() + 1), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "p.id".equals(item.get("label"))
                        && "column".equals(item.get("kind"))));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteDoesNotQualifyColumnsForCatalogQualifiedUnaliasedSystemTable()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        String text = "SELECT * FROM sem#products WHERE ";

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete", Map.of("fileId", "file-1", "version", 1L, "text", text, "engineState", semanticEngineState(),
                "cursor", Map.of("line", 1, "column", text.length() + 1), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "id".equals(item.get("label"))
                        && "id".equals(item.get("insertText"))));
        Assertions.assertFalse(items.stream()
                .anyMatch(item -> String.valueOf(item.get("label"))
                        .startsWith("sem#products.")));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlHoverDoesNotQualifyColumnForCatalogQualifiedUnaliasedSystemTable()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        String text = "SELECT * FROM sem#products WHERE id = 1";

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.hover",
                Map.of("fileId", "file-1", "text", text, "engineState", semanticEngineState(), "cursor", Map.of("line", 1, "column", text.indexOf("id") + 2)));

        List<Map<String, Object>> contents = (List<Map<String, Object>>) result.get("contents");
        String value = String.valueOf(contents.get(0)
                .get("value"));
        Assertions.assertTrue(value.contains("Payloadbuilder Column: id"), value);
        Assertions.assertFalse(value.contains("sem#products.id"));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlHoverUsesExplicitCatalogPrefixForSystemTableCatalogTable()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        String text = "SELECT * FROM sem#products";

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.hover",
                Map.of("fileId", "file-1", "text", text, "engineState", semanticEngineStateWithoutDefault(), "cursor", Map.of("line", 1, "column", text.indexOf("products") + 2)));

        List<Map<String, Object>> contents = (List<Map<String, Object>>) result.get("contents");
        String value = String.valueOf(contents.get(0)
                .get("value"));
        Assertions.assertTrue(value.contains("Payloadbuilder Table: sem#products"), value);
        Assertions.assertTrue(value.contains("| id | int |"), value);
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteResolvesCatalogFromAliasReference()
    {
        JdbcSqlEditorServices jdbcSqlEditorServices = Mockito.mock(JdbcSqlEditorServices.class);
        Mockito.when(jdbcSqlEditorServices.complete(Mockito.any()))
                .thenReturn(List.of(new JdbcSqlEditorServices.CompletionItem("id", "column", "JDBC column", null, "id", "plain", "jdbc.schema")));
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, jdbcRuntimeServiceFor("conn-1"), jdbcSqlEditorServices);
        Map<String, Object> engineState = Map.of("payloadbuilder",
                Map.of("defaultCatalogAlias", "jdbc", "catalogs", Map.of("jdbc", Map.of("catalogId", "jdbc", "properties", Map.of("connectionId", "conn-1", "database", "appdb")))));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete", Map.of("fileId", "file-1", "version", 1L, "text",
                "SELECT * FROM jdbc#dbo.Article_ListPage lp WHERE lp.", "engineState", engineState, "cursor", Map.of("line", 1, "column", 52), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertFalse(items.isEmpty());
        Mockito.verify(jdbcSqlEditorServices)
                .complete(Mockito.argThat(request -> "conn-1".equals(request.connectionId())
                        && "appdb".equals(request.database())
                        && "COLUMN_REFERENCE".equals(request.sqlContext())
                        && "lp".equals(request.prefix())));
    }

    @Test
    void normalizeAliasesStripsCatalogPrefixFromBothKeysAndValues()
    {
        Map<String, String> result = PayloadbuilderCatalogSqlEditorServices.normalizeAliases(Map.of("jdbc#dbo.tableA", "jdbc#dbo.tableA"));
        Assertions.assertEquals(Map.of("dbo.tableA", "dbo.tableA"), result);
    }

    @Test
    void normalizeAliasesHandlesExplicitAliases()
    {
        Map<String, String> result = PayloadbuilderCatalogSqlEditorServices.normalizeAliases(Map.of("t", "jdbc#dbo.tableA"));
        Assertions.assertEquals(Map.of("t", "dbo.tableA", "dbo.tableA", "t"), result);
    }

    @Test
    void normalizeAliasesDoesNotDuplicateTableNames()
    {
        Map<String, String> result = PayloadbuilderCatalogSqlEditorServices.normalizeAliases(Map.of("jdbc#dbo.tableA", "jdbc#dbo.tableA"));
        long distinctValues = result.values()
                .stream()
                .distinct()
                .count();
        Assertions.assertEquals(1, distinctValues);
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteWithAliasLessTableCompletesColumnsInWhereClause()
    {
        JdbcSqlEditorServices jdbcSqlEditorServices = Mockito.mock(JdbcSqlEditorServices.class);
        Mockito.when(jdbcSqlEditorServices.complete(Mockito.any()))
                .thenReturn(List.of(new JdbcSqlEditorServices.CompletionItem("jdbc.col1", "column", "jdbc.col1", null, "jdbc.col1", "plain", "jdbc.schema")));
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, jdbcRuntimeServiceFor("conn-1"), jdbcSqlEditorServices);
        Map<String, Object> engineState = Map.of("payloadbuilder",
                Map.of("defaultCatalogAlias", "jdbc", "catalogs", Map.of("jdbc", Map.of("catalogId", "jdbc", "properties", Map.of("connectionId", "conn-1", "database", "appdb")))));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        String text = "SELECT * FROM jdbc#dbo.Article_ListPage WHERE ";

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", text, "engineState", engineState, "cursor", Map.of("line", 1, "column", text.length() + 1), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "col1".equals(item.get("label"))
                        && "col1".equals(item.get("insertText"))));
        Assertions.assertFalse(items.stream()
                .anyMatch(item -> String.valueOf(item.get("label"))
                        .startsWith("jdbc.")));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteRoutesUnqualifiedJdbcColumnsFromCatalogQualifiedRelationWithoutDefault()
    {
        JdbcSqlEditorServices jdbcSqlEditorServices = Mockito.mock(JdbcSqlEditorServices.class);
        Mockito.when(jdbcSqlEditorServices.complete(Mockito.any()))
                .thenReturn(List.of(new JdbcSqlEditorServices.CompletionItem("id", "column", "JDBC column", null, "id", "plain", "jdbc.schema")));
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, jdbcRuntimeServiceFor("conn-1"), jdbcSqlEditorServices);
        Map<String, Object> engineState = jdbcCatalogEngineStateWithoutDefault();
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        String text = "SELECT * FROM jdbc#dbo.Article_ListPage WHERE ";

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", text, "engineState", engineState, "cursor", Map.of("line", 1, "column", text.length() + 1), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "id".equals(item.get("label"))));
        Mockito.verify(jdbcSqlEditorServices)
                .complete(Mockito.argThat(request -> "conn-1".equals(request.connectionId())
                        && "COLUMN_REFERENCE".equals(request.sqlContext())
                        && "".equals(request.prefix())
                        && "dbo.Article_ListPage".equals(request.aliases()
                                .get("dbo.article_listpage"))));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlHoverRoutesUnqualifiedJdbcColumnFromCatalogQualifiedRelationWithoutDefault()
    {
        JdbcSqlEditorServices jdbcSqlEditorServices = Mockito.mock(JdbcSqlEditorServices.class);
        Mockito.when(jdbcSqlEditorServices.hover(Mockito.any()))
                .thenReturn(new JdbcSqlEditorServices.Hover("**Column: id**"));
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, jdbcRuntimeServiceFor("conn-1"), jdbcSqlEditorServices);
        Map<String, Object> engineState = jdbcCatalogEngineStateWithoutDefault();
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        String text = "SELECT * FROM jdbc#dbo.Article_ListPage WHERE id = 1";

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.hover",
                Map.of("fileId", "file-1", "text", text, "engineState", engineState, "cursor", Map.of("line", 1, "column", text.indexOf("id") + 2)));

        List<Map<String, Object>> contents = (List<Map<String, Object>>) result.get("contents");
        Assertions.assertTrue(String.valueOf(contents.get(0)
                .get("value"))
                .contains("Column: id"));
        Mockito.verify(jdbcSqlEditorServices)
                .hover(Mockito.argThat(request -> "conn-1".equals(request.connectionId())
                        && "COLUMN_REFERENCE".equals(request.sqlContext())
                        && "id".equals(request.token())
                        && "dbo.Article_ListPage".equals(request.aliases()
                                .get("dbo.article_listpage"))));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompletePreservesExplicitAliasThatEqualsCatalogAlias()
    {
        JdbcSqlEditorServices jdbcSqlEditorServices = Mockito.mock(JdbcSqlEditorServices.class);
        Mockito.when(jdbcSqlEditorServices.complete(Mockito.any()))
                .thenReturn(List.of(new JdbcSqlEditorServices.CompletionItem("jdbc.col1", "column", "jdbc.col1", null, "jdbc.col1", "plain", "jdbc.schema")));
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, jdbcRuntimeServiceFor("conn-1"), jdbcSqlEditorServices);
        Map<String, Object> engineState = Map.of("payloadbuilder",
                Map.of("defaultCatalogAlias", "jdbc", "catalogs", Map.of("jdbc", Map.of("catalogId", "jdbc", "properties", Map.of("connectionId", "conn-1", "database", "appdb")))));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        String text = "SELECT * FROM jdbc#dbo.Article_ListPage jdbc WHERE jdbc.";

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", text, "engineState", engineState, "cursor", Map.of("line", 1, "column", text.length() + 1), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "jdbc.col1".equals(item.get("label"))
                        && "jdbc.col1".equals(item.get("insertText"))));
        Mockito.verify(jdbcSqlEditorServices)
                .complete(Mockito.argThat(request -> "jdbc.".equals(request.prefix())
                        && "dbo.Article_ListPage".equals(request.aliases()
                                .get("jdbc"))));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteDoesNotUseCatalogThatHasNotOptedIn()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(false));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete", Map.of("fileId", "file-1", "version", 1L, "text", "SELECT * FROM pro", "engineState",
                semanticEngineState(), "cursor", Map.of("line", 1, "column", 18), "limits", Map.of("maxItems", 50)));

        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertFalse(items.stream()
                .anyMatch(item -> "products".equals(item.get("label"))));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlSemanticActionsUseSharedJdbcSqlEditorServicesForJdbcCatalog()
    {
        JdbcSqlEditorServices jdbcSqlEditorServices = Mockito.mock(JdbcSqlEditorServices.class);
        Mockito.when(jdbcSqlEditorServices.complete(Mockito.any()))
                .thenReturn(List.of(new JdbcSqlEditorServices.CompletionItem("orders", "table", "JDBC table", null, "orders", "plain", "jdbc.schema")));
        Mockito.when(jdbcSqlEditorServices.hover(Mockito.any()))
                .thenReturn(new JdbcSqlEditorServices.Hover("**Table: PUBLIC.ORDERS**"));
        Mockito.when(jdbcSqlEditorServices.symbolAtPosition(Mockito.any()))
                .thenReturn(new JdbcSqlEditorServices.Symbol("table", "PUBLIC.ORDERS", "APPDB.PUBLIC.ORDERS", "TABLE", Map.of("name", "ORDERS")));
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, jdbcRuntimeServiceFor("conn-1"), jdbcSqlEditorServices);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        Map<String, Object> engineState = jdbcCatalogEngineState();

        Map<String, Object> complete = (Map<String, Object>) provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", "SELECT * FROM ord", "engineState", engineState, "cursor", Map.of("line", 1, "column", 18), "limits", Map.of("maxItems", 50)));
        List<Map<String, Object>> items = (List<Map<String, Object>>) complete.get("items");
        Assertions.assertTrue(items.stream()
                .anyMatch(item -> "orders".equals(item.get("label"))
                        && "jdbc1".equals(item.get("source"))));

        Map<String, Object> hover = (Map<String, Object>) provider.invoke("file-1", "sql.hover",
                Map.of("fileId", "file-1", "text", "SELECT * FROM orders", "engineState", engineState, "cursor", Map.of("line", 1, "column", 18)));
        Assertions.assertTrue(String.valueOf(hover.get("contents"))
                .contains("PUBLIC.ORDERS"));

        Map<String, Object> symbol = (Map<String, Object>) provider.invoke("file-1", "sql.symbolAtPosition",
                Map.of("fileId", "file-1", "text", "SELECT * FROM orders", "engineState", engineState, "cursor", Map.of("line", 1, "column", 18)));
        Assertions.assertEquals("table", symbol.get("kind"));
        Map<String, Object> attributes = (Map<String, Object>) symbol.get("attributes");
        Assertions.assertEquals("jdbc1", attributes.get("catalogAlias"));

        Mockito.verify(jdbcSqlEditorServices)
                .complete(Mockito.argThat(request -> "conn-1".equals(request.connectionId())
                        && "appdb".equals(request.database())
                        && "TABLE_REFERENCE".equals(request.sqlContext())
                        && "ord".equals(request.prefix())));
        Mockito.verify(jdbcSqlEditorServices)
                .hover(Mockito.argThat(request -> "conn-1".equals(request.connectionId())
                        && "appdb".equals(request.database())
                        && "orders".equals(request.token())));
        Mockito.verify(jdbcSqlEditorServices)
                .symbolAtPosition(Mockito.argThat(request -> "conn-1".equals(request.connectionId())
                        && "appdb".equals(request.database())
                        && "orders".equals(request.token())));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlHoverAndSymbolStripCatalogDotPrefixWhenNotExplicitAlias()
    {
        JdbcSqlEditorServices jdbcSqlEditorServices = Mockito.mock(JdbcSqlEditorServices.class);
        Mockito.when(jdbcSqlEditorServices.hover(Mockito.any()))
                .thenReturn(new JdbcSqlEditorServices.Hover("jdbc.col1"));
        Mockito.when(jdbcSqlEditorServices.symbolAtPosition(Mockito.any()))
                .thenReturn(new JdbcSqlEditorServices.Symbol("column", "jdbc.col1", "jdbc.dbo.orders.col1", "jdbc.column", Map.of("name", "COL1")));
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, jdbcRuntimeServiceFor("conn-1"), jdbcSqlEditorServices);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        Map<String, Object> engineState = Map.of("payloadbuilder",
                Map.of("defaultCatalogAlias", "jdbc", "catalogs", Map.of("jdbc", Map.of("catalogId", "jdbc", "properties", Map.of("connectionId", "conn-1", "database", "appdb")))));

        Map<String, Object> hover = (Map<String, Object>) provider.invoke("file-1", "sql.hover",
                Map.of("fileId", "file-1", "text", "SELECT * FROM orders", "engineState", engineState, "cursor", Map.of("line", 1, "column", 18)));
        List<Map<String, Object>> contents = (List<Map<String, Object>>) hover.get("contents");
        Assertions.assertEquals("col1", contents.get(0)
                .get("value"));

        Map<String, Object> symbol = (Map<String, Object>) provider.invoke("file-1", "sql.symbolAtPosition",
                Map.of("fileId", "file-1", "text", "SELECT * FROM orders", "engineState", engineState, "cursor", Map.of("line", 1, "column", 18)));
        Assertions.assertEquals("col1", symbol.get("name"));
        Assertions.assertEquals("dbo.orders.col1", symbol.get("fullName"));
        Assertions.assertEquals("column", symbol.get("detail"));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlCompleteExtractsCatalogAliasFromFromClauseAndRoutesToCorrectRuntime()
    {
        JdbcSqlEditorServices jdbcSqlEditorServices = Mockito.mock(JdbcSqlEditorServices.class);
        Mockito.when(jdbcSqlEditorServices.complete(Mockito.any()))
                .thenReturn(List.of(new JdbcSqlEditorServices.CompletionItem("order_id", "column", "JDBC column", null, "order_id", "plain", "jdbc.schema")));
        Map<String, Object> engineState = Map.of("payloadbuilder",
                Map.of("defaultCatalogAlias", "myalias", "catalogs", Map.of("myalias", Map.of("catalogId", "jdbc", "properties", Map.of("connectionId", "conn-1", "database", "appdb")))));
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, jdbcRuntimeServiceFor("conn-1"), jdbcSqlEditorServices);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.complete", Map.of("fileId", "file-1", "version", 1L, "text", "SELECT * FROM myalias#orders WHERE myalias.or",
                "engineState", engineState, "cursor", Map.of("line", 1, "column", 50), "limits", Map.of("maxItems", 50)));
        List<Map<String, Object>> items = (List<Map<String, Object>>) result.get("items");
        Assertions.assertFalse(items.isEmpty());

        Mockito.verify(jdbcSqlEditorServices)
                .complete(Mockito.argThat(request ->
                {
                    if (!"conn-1".equals(request.connectionId()))
                    {
                        return false;
                    }
                    if (!"appdb".equals(request.database()))
                    {
                        return false;
                    }
                    // Handler routes to the "myalias" catalog runtime, then the JDBC adapter strips the catalog qualifier from the prefix before delegation.
                    Map<String, String> aliases = request.aliases();
                    String ordersAlias = aliases.get("orders");
                    String myaliasAlias = aliases.get("myalias");
                    return "or".equals(request.prefix())
                            && "myalias".equals(ordersAlias)
                            && "orders".equals(myaliasAlias);
                }));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlHoverUsesOptedInPayloadbuilderCatalog()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.hover",
                Map.of("fileId", "file-1", "text", "SELECT * FROM products", "engineState", semanticEngineState(), "cursor", Map.of("line", 1, "column", 18)));

        List<Map<String, Object>> contents = (List<Map<String, Object>>) result.get("contents");
        Assertions.assertTrue(String.valueOf(contents.get(0)
                .get("value"))
                .contains("Payloadbuilder Table"));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeSqlSymbolAtPositionUsesOptedInPayloadbuilderCatalog()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        registry.registerContributor(new TestSemanticCatalogProvider(true));
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);

        Map<String, Object> result = (Map<String, Object>) provider.invoke("file-1", "sql.symbolAtPosition",
                Map.of("fileId", "file-1", "text", "SELECT * FROM products", "engineState", semanticEngineState(), "cursor", Map.of("line", 1, "column", 18)));

        Assertions.assertEquals("table", result.get("kind"));
        Assertions.assertEquals("products", result.get("name"));
    }

    @Test
    void executeReturnsInternalFailureWhenPayloadMapperConvertThrows()
    {
        PayloadMapper throwingMapper = new PayloadMapper()
        {
            @Override
            public <T> T convert(Object payload, Class<T> targetType)
            {
                throw new RuntimeException("boom");
            }

            @Override
            public <T> List<T> convertToList(Object payload, Class<T> elementType)
            {
                return List.of();
            }

            @Override
            public <T> T parseJson(String json, Class<T> targetType)
            {
                throw new UnsupportedOperationException();
            }

            @Override
            public String writeJson(Object value)
            {
                return "{}";
            }
        };
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, throwingMapper, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, throwingMapper, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-internal", "file-1", "select 1", Map.of(), publisher);

        Assertions.assertEquals("INTERNAL", publisher.errorCode);
        Assertions.assertTrue(publisher.errorMessage.contains("boom"));
    }

    @Test
    void executeReturnsCancelledFailureWhenCancelPrecedesInternalException()
    {
        PayloadMapper throwingMapper = new PayloadMapper()
        {
            @Override
            public <T> T convert(Object payload, Class<T> targetType)
            {
                throw new RuntimeException("boom");
            }

            @Override
            public <T> List<T> convertToList(Object payload, Class<T> elementType)
            {
                return List.of();
            }

            @Override
            public <T> T parseJson(String json, Class<T> targetType)
            {
                throw new UnsupportedOperationException();
            }

            @Override
            public String writeJson(Object value)
            {
                return "{}";
            }
        };
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, throwingMapper, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, throwingMapper, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        RecordingPublisher publisher = new RecordingPublisher();

        provider.cancel("exec-cancelled-internal");
        provider.execute("exec-cancelled-internal", "file-1", "select 1", Map.of(), publisher);

        Assertions.assertEquals("CANCELLED", publisher.errorCode);
        Assertions.assertEquals("Execution cancelled by client", publisher.errorMessage);
    }

    @Test
    void resolveEnvironmentVariablesReturnsEmptyWhenModuleIsMissing()
    {
        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return null;
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return null;
            }
        };
        PayloadbuilderQueryEngineProvider provider = createProvider(config);
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-novarmod", "file-1", "select 1", Map.of("payloadbuilder", Map.of("selectedEnvironmentId", "any")), publisher);

        Assertions.assertNull(publisher.errorCode, publisher.errorMessage);
        Assertions.assertTrue(publisher.completed);
    }

    @Test
    void resolveEnvironmentVariablesReturnsEmptyWhenModuleValuesIsNull()
    {
        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return new SettingsModule("core.queryengine.payloadbuilder.environments", 1L, "2026-01-01T00:00:00Z", null);
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return null;
            }
        };
        PayloadbuilderQueryEngineProvider provider = createProvider(config);
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-novarvalues", "file-1", "select 1", Map.of("payloadbuilder", Map.of("selectedEnvironmentId", "any")), publisher);

        Assertions.assertNull(publisher.errorCode, publisher.errorMessage);
        Assertions.assertTrue(publisher.completed);
    }

    @Test
    void resolveEnvironmentVariablesReturnsEmptyWhenSelectedEnvNotFound()
    {
        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return new SettingsModule("core.queryengine.payloadbuilder.environments", 1L, "2026-01-01T00:00:00Z",
                        Map.of("core.queryengine.payloadbuilder.environments.values", List.of(Map.of("id", "production", "title", "Production", "variables", List.of()))));
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return null;
            }
        };
        PayloadbuilderQueryEngineProvider provider = createProvider(config);
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-noenv", "file-1", "select 1", Map.of("payloadbuilder", Map.of("selectedEnvironmentId", "missing")), publisher);

        Assertions.assertNull(publisher.errorCode, publisher.errorMessage);
        Assertions.assertTrue(publisher.completed);
    }

    @Test
    void onOpenOnChangeOnCloseDelegateToParseSessionService()
    {
        IncrementalParseSessionService sessions = Mockito.mock(IncrementalParseSessionService.class);
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, sessions, PARSE_FUNCTION);
        FileSession session = new FileSession("file-1", java.net.URI.create("file:///tmp.sql"), "text/sql", "jdbc", "jdbc-1", 1L);

        provider.onOpen(session, "select 1");
        Mockito.verify(sessions)
                .open("payloadbuilder", "file-1", 1L, TreeSitterSqlParseFunction.LANGUAGE_SQL, "select 1", PARSE_FUNCTION);

        provider.onChange(session, 2L, "select 2");
        Mockito.verify(sessions)
                .change("payloadbuilder", "file-1", 2L, TreeSitterSqlParseFunction.LANGUAGE_SQL, "select 2", PARSE_FUNCTION);

        provider.onClose(session);
        Mockito.verify(sessions)
                .close("payloadbuilder", "file-1");
    }

    @Test
    void cancelWithoutActiveSessionJustFlagsTheId()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);

        provider.cancel("exec-not-active");

        RecordingPublisher publisher = new RecordingPublisher();
        Map<String, Object> engineState = Map.of("payloadbuilder", Map.of("catalogs", Map.of()));
        provider.execute("exec-not-active", "file-1", "select 1", engineState, publisher);
        Assertions.assertNull(publisher.errorCode, publisher.errorMessage);
        Assertions.assertTrue(publisher.completed);
    }

    @Test
    void engineIdReturnsPayloadbuilder()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        Assertions.assertEquals("payloadbuilder", provider.engineId());
    }

    @Test
    void cancelFiresAbortQueryListenersOnActiveSession() throws Exception
    {
        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return null;
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return null;
            }
        };
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(config, TEST_MAPPER, JDBCRUNTIMESERVICE, JDBC_SQL_EDITOR_SERVICES);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(config, TEST_MAPPER, registry, PARSE_SESSIONS, PARSE_FUNCTION);
        Map<String, SessionHolder> executionIdMap = provider.sessionByExecutionId;

        // Create a mock session
        QuerySession mockSession = Mockito.mock(QuerySession.class);

        // Inject the holder
        String executionId = "exec-fire-abort-test";
        executionIdMap.put(executionId, new SessionHolder(mockSession, "test-session-id"));

        // Call cancel - this should call fireAbortQueryListeners on the mock
        provider.cancel(executionId);

        // Verify fireAbortQueryListeners was called
        Mockito.verify(mockSession)
                .fireAbortQueryListeners();
    }

    private static Map<String, Object> semanticEngineState()
    {
        return Map.of("payloadbuilder", Map.of("defaultCatalogAlias", "sem", "catalogs", Map.of("sem", Map.of("catalogId", TestSemanticCatalog.CATALOG_ID, "properties", Map.of()))));
    }

    private static Map<String, Object> semanticEngineStateWithoutDefault()
    {
        return Map.of("payloadbuilder", Map.of("catalogs", Map.of("sem", Map.of("catalogId", TestSemanticCatalog.CATALOG_ID, "properties", Map.of()))));
    }

    private static Map<String, Object> jdbcCatalogEngineState()
    {
        return Map.of("payloadbuilder",
                Map.of("defaultCatalogAlias", "jdbc1", "catalogs", Map.of("jdbc1", Map.of("catalogId", "jdbc", "properties", Map.of("connectionId", "conn-1", "database", "appdb")))));
    }

    private static Map<String, Object> jdbcCatalogEngineStateWithoutDefault()
    {
        return Map.of("payloadbuilder", Map.of("catalogs", Map.of("jdbc", Map.of("catalogId", "jdbc", "properties", Map.of("connectionId", "conn-1", "database", "appdb")))));
    }

    private static Map<String, Object> aliasEchoEngineState(String alias)
    {
        return Map.of("payloadbuilder", Map.of("defaultCatalogAlias", alias, "catalogs", Map.of(alias, Map.of("catalogId", AliasEchoCatalog.CATALOG_ID, "properties", Map.of()))));
    }

    private static Map<String, Object> propertyEchoEngineState(Map<String, Object> properties)
    {
        return Map.of("payloadbuilder", Map.of("defaultCatalogAlias", "prop", "catalogs", Map.of("prop", Map.of("catalogId", PropertyEchoCatalog.CATALOG_ID, "properties", properties))));
    }

    private static String sessionId(Object engineState)
    {
        Assertions.assertTrue(engineState instanceof Map<?, ?>, "Expected engine state patch map");
        Map<?, ?> root = (Map<?, ?>) engineState;
        Object payloadbuilder = root.get("payloadbuilder");
        Assertions.assertTrue(payloadbuilder instanceof Map<?, ?>, "Expected payloadbuilder patch map");
        Object sessionId = ((Map<?, ?>) payloadbuilder).get("sessionId");
        Assertions.assertTrue(sessionId instanceof String, "Expected sessionId patch");
        return (String) sessionId;
    }

    private static JdbcRuntimeService jdbcRuntimeServiceFor(String connectionId)
    {
        JdbcDialect dialect = Mockito.mock(JdbcDialect.class);
        Mockito.when(dialect.metadata())
                .thenReturn(new JdbcDialectMetadata("jdbc", "JDBC", null, "", "org.h2.Driver"));
        Mockito.when(dialect.buildUrl(Mockito.any()))
                .thenReturn("jdbc:h2:mem:test");
        JdbcConnection connection = new JdbcConnection(connectionId, "Test connection", dialect, Map.of());
        JdbcConnections connections = Mockito.mock(JdbcConnections.class);
        Mockito.when(connections.resolve(connectionId))
                .thenReturn(connection);
        JdbcRuntimeService runtimeService = Mockito.mock(JdbcRuntimeService.class);
        Mockito.when(runtimeService.connections())
                .thenReturn(connections);
        return runtimeService;
    }

    private record TestSemanticCatalogProvider(boolean optIn) implements PayloadbuilderCatalogProviderContributor
    {
        @Override
        public String catalogId()
        {
            return TestSemanticCatalog.CATALOG_ID;
        }

        @Override
        public Catalog createCatalog()
        {
            return new TestSemanticCatalog();
        }

        @Override
        public PayloadbuilderCatalogSqlEditorServices editorServices()
        {
            return optIn ? PayloadbuilderSystemTableSqlEditorServices.INSTANCE
                    : PayloadbuilderCatalogSqlEditorServices.NONE;
        }
    }

    private record AliasEchoCatalogProvider() implements PayloadbuilderCatalogProviderContributor
    {
        @Override
        public String catalogId()
        {
            return AliasEchoCatalog.CATALOG_ID;
        }

        @Override
        public Catalog createCatalog()
        {
            return new AliasEchoCatalog();
        }
    }

    private record PropertyEchoCatalogProvider() implements PayloadbuilderCatalogProviderContributor
    {
        @Override
        public String catalogId()
        {
            return PropertyEchoCatalog.CATALOG_ID;
        }

        @Override
        public Catalog createCatalog()
        {
            return new PropertyEchoCatalog();
        }
    }

    private record BlockingPropertyEchoCatalogProvider(BlockingPropertyEchoCatalog catalog) implements PayloadbuilderCatalogProviderContributor
    {
        @Override
        public String catalogId()
        {
            return PropertyEchoCatalog.CATALOG_ID;
        }

        @Override
        public Catalog createCatalog()
        {
            return catalog;
        }
    }

    private record TranslatedPropertyEchoCatalogProvider() implements PayloadbuilderCatalogProviderContributor
    {
        @Override
        public String catalogId()
        {
            return PropertyEchoCatalog.CATALOG_ID;
        }

        @Override
        public Catalog createCatalog()
        {
            return new PropertyEchoCatalog();
        }

        @Override
        public void injectProperties(IQuerySession session, String alias, Map<String, Object> properties)
        {
            if (properties.containsKey("inputValue"))
            {
                session.setCatalogProperty(alias, PropertyEchoCatalog.VALUE_PROPERTY, properties.get("inputValue"));
            }
        }

        @Override
        public void clearProperties(IQuerySession session, String alias, Map<String, Object> inputProperties)
        {
            PayloadbuilderCatalogProviderContributor.super.clearProperties(session, alias, inputProperties);
            session.setCatalogProperty(alias, PropertyEchoCatalog.VALUE_PROPERTY, (Object) null);
        }
    }

    private static final class AliasEchoCatalog extends Catalog
    {
        private static final String CATALOG_ID = "test.aliasEcho";
        private static final String ITEMS_TABLE = "items";
        private static final Schema ITEMS_SCHEMA = Schema.of(Column.of("alias", ResolvedType.STRING));

        AliasEchoCatalog()
        {
            super(CATALOG_ID);
        }

        @Override
        public TableSchema getTableSchema(IExecutionContext context, String catalogAlias, QualifiedName table)
        {
            if (ITEMS_TABLE.equalsIgnoreCase(table.getLast()))
            {
                return new TableSchema(ITEMS_SCHEMA);
            }
            return TableSchema.EMPTY;
        }

        @Override
        public IDatasource getScanDataSource(IQuerySession session, String catalogAlias, QualifiedName table, DatasourceData data)
        {
            if (!ITEMS_TABLE.equalsIgnoreCase(table.getLast()))
            {
                return _ -> TupleIterator.EMPTY;
            }
            return _ -> TupleIterator.singleton(new se.kuseman.payloadbuilder.api.execution.ObjectTupleVector(ITEMS_SCHEMA, 1, (_, _) -> catalogAlias));
        }
    }

    private static final class PropertyEchoCatalog extends Catalog
    {
        private static final String CATALOG_ID = "test.propertyEcho";
        private static final String ITEMS_TABLE = "items";
        private static final String VALUE_PROPERTY = "value";
        private static final Schema ITEMS_SCHEMA = Schema.of(Column.of(VALUE_PROPERTY, ResolvedType.STRING));

        PropertyEchoCatalog()
        {
            super(CATALOG_ID);
        }

        @Override
        public TableSchema getTableSchema(IExecutionContext context, String catalogAlias, QualifiedName table)
        {
            if (ITEMS_TABLE.equalsIgnoreCase(table.getLast()))
            {
                return new TableSchema(ITEMS_SCHEMA);
            }
            return TableSchema.EMPTY;
        }

        @Override
        public IDatasource getScanDataSource(IQuerySession session, String catalogAlias, QualifiedName table, DatasourceData data)
        {
            if (!ITEMS_TABLE.equalsIgnoreCase(table.getLast()))
            {
                return _ -> TupleIterator.EMPTY;
            }
            return _ -> TupleIterator.singleton(new se.kuseman.payloadbuilder.api.execution.ObjectTupleVector(ITEMS_SCHEMA, 1, (_, _) ->
            {
                ValueVector value = session.getCatalogProperty(catalogAlias, VALUE_PROPERTY);
                return value == null
                        || value.isNull(0) ? null
                                : value.valueAsObject(0);
            }));
        }
    }

    private static final class BlockingPropertyEchoCatalog extends Catalog
    {
        private final CountDownLatch firstEntered = new CountDownLatch(1);
        private final CountDownLatch secondEntered = new CountDownLatch(1);
        private final CountDownLatch releaseFirst = new CountDownLatch(1);
        private final AtomicInteger invocations = new AtomicInteger();
        private final AtomicInteger active = new AtomicInteger();
        private final AtomicInteger maxActive = new AtomicInteger();

        BlockingPropertyEchoCatalog()
        {
            super(PropertyEchoCatalog.CATALOG_ID);
        }

        @Override
        public TableSchema getTableSchema(IExecutionContext context, String catalogAlias, QualifiedName table)
        {
            return new TableSchema(PropertyEchoCatalog.ITEMS_SCHEMA);
        }

        @Override
        public IDatasource getScanDataSource(IQuerySession session, String catalogAlias, QualifiedName table, DatasourceData data)
        {
            return _ ->
            {
                int invocation = invocations.incrementAndGet();
                int activeCount = active.incrementAndGet();
                maxActive.accumulateAndGet(activeCount, Math::max);
                if (invocation == 1)
                {
                    firstEntered.countDown();
                    try
                    {
                        if (!releaseFirst.await(5, TimeUnit.SECONDS))
                        {
                            throw new IllegalStateException("Timed out waiting to release first execution");
                        }
                    }
                    catch (InterruptedException e)
                    {
                        Thread.currentThread()
                                .interrupt();
                        throw new IllegalStateException(e);
                    }
                }
                else
                {
                    secondEntered.countDown();
                }
                ValueVector value = session.getCatalogProperty(catalogAlias, PropertyEchoCatalog.VALUE_PROPERTY);
                Object result = value == null
                        || value.isNull(0) ? null
                                : value.valueAsObject(0);
                active.decrementAndGet();
                return TupleIterator.singleton(new se.kuseman.payloadbuilder.api.execution.ObjectTupleVector(PropertyEchoCatalog.ITEMS_SCHEMA, 1, (_, _) -> result));
            };
        }
    }

    private static final class TestSemanticCatalog extends Catalog
    {
        private static final String CATALOG_ID = "test.semantic";
        private static final String PRODUCTS_TABLE = "products";
        private static final String DASHED_TABLE = "sales.order-items";
        private static final String PRODUCTS_BY_CATEGORY_FUNCTION = "products_by_category";
        private static final Schema PRODUCTS_SCHEMA = Schema.of(Column.of("id", ResolvedType.INT), Column.of("name", ResolvedType.STRING), Column.of("category", ResolvedType.STRING),
                Column.of("external-id", ResolvedType.STRING));

        TestSemanticCatalog()
        {
            super(CATALOG_ID);
            registerFunction(new ProductsByCategoryFunction());
        }

        @Override
        public TableSchema getSystemTableSchema(IQuerySession session, String catalogAlias, QualifiedName table)
        {
            String systemTable = table.getLast();
            if (SYS_TABLES.equalsIgnoreCase(systemTable))
            {
                return new TableSchema(Schema.of(Column.of(SYS_TABLES_NAME, Column.Type.String)));
            }
            if (SYS_COLUMNS.equalsIgnoreCase(systemTable))
            {
                return new TableSchema(Schema.of(Column.of(SYS_COLUMNS_TABLE, Column.Type.String), Column.of(SYS_COLUMNS_NAME, Column.Type.String), Column.of("type", Column.Type.String)));
            }
            if (SYS_FUNCTIONS.equalsIgnoreCase(systemTable))
            {
                return new TableSchema(SYS_FUNCTIONS_SCHEMA);
            }
            return TableSchema.EMPTY;
        }

        @Override
        public IDatasource getSystemTableDataSource(IQuerySession session, String catalogAlias, QualifiedName table, DatasourceData data)
        {
            String systemTable = table.getLast();
            if (SYS_TABLES.equalsIgnoreCase(systemTable))
            {
                Schema schema = Schema.of(Column.of(SYS_TABLES_NAME, Column.Type.String));
                return _ -> TupleIterator.singleton(new se.kuseman.payloadbuilder.api.execution.ObjectTupleVector(schema, 2, (row, _) -> row == 0 ? PRODUCTS_TABLE
                        : DASHED_TABLE));
            }
            if (SYS_COLUMNS.equalsIgnoreCase(systemTable))
            {
                Schema schema = Schema.of(Column.of(SYS_COLUMNS_TABLE, Column.Type.String), Column.of(SYS_COLUMNS_NAME, Column.Type.String), Column.of("type", Column.Type.String));
                return _ -> TupleIterator.singleton(new se.kuseman.payloadbuilder.api.execution.ObjectTupleVector(schema, PRODUCTS_SCHEMA.getSize(), (row, col) ->
                {
                    Column column = PRODUCTS_SCHEMA.getColumns()
                            .get(row);
                    return switch (col)
                    {
                        case 0 -> PRODUCTS_TABLE;
                        case 1 -> column.getName();
                        case 2 -> column.getType()
                                .getType()
                                .name()
                                .toLowerCase();
                        default -> null;
                    };
                }));
            }
            if (SYS_FUNCTIONS.equalsIgnoreCase(systemTable))
            {
                return _ -> TupleIterator.singleton(getFunctionsTupleVector(SYS_FUNCTIONS_SCHEMA));
            }
            return _ -> TupleIterator.EMPTY;
        }

        private static final class ProductsByCategoryFunction extends TableFunctionInfo
        {
            ProductsByCategoryFunction()
            {
                super(PRODUCTS_BY_CATEGORY_FUNCTION);
            }

            @Override
            public String getDescription()
            {
                return "Returns products by category";
            }

            @Override
            public FunctionInfo.Arity arity()
            {
                return new FunctionInfo.Arity(1, 1);
            }

            @Override
            public Schema getSchema(IExecutionContext context, String catalogAlias, List<IExpression> arguments, List<Option> options)
            {
                return PRODUCTS_SCHEMA;
            }

            @Override
            public TupleIterator execute(IExecutionContext context, String catalogAlias, List<IExpression> arguments, FunctionData functionData)
            {
                return TupleIterator.EMPTY;
            }
        }
    }

    @Test
    void jackson2DependenciesAreBinaryCompatible()
    {
        var node = Assertions.assertDoesNotThrow(() -> new ObjectMapper().readTree("1.25"));
        Assertions.assertEquals(1.25D, node.doubleValue());
    }

    private static final class RecordingPublisher implements QueryPublisher
    {
        private boolean completed;
        private boolean completedWithPatchCalled;
        private String errorCode;
        private String errorMessage;
        private Map<String, Object> errorDetails = Map.of();
        private Object engineState;

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
        }

        @Override
        public void resultSetRows(List<List<Object>> rows, List<OutputEvent> messages)
        {
        }

        @Override
        public void completed(long durationMs, long rowCount)
        {
            completed = true;
        }

        @Override
        public void completed(long durationMs, long rowCount, Object engineState)
        {
            completed = true;
            completedWithPatchCalled = true;
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
            this.errorDetails = details == null ? Map.of()
                    : details;
        }
    }

    private static final class ChunkRecordingPublisher implements QueryPublisher
    {
        private final List<Integer> chunkSizes = new java.util.ArrayList<>();

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
            chunkSizes.add(rows.size());
        }

        @Override
        public void resultSetRows(List<List<Object>> rows, List<OutputEvent> messages)
        {
        }

        @Override
        public void completed(long durationMs, long rowCount)
        {
        }

        @Override
        public void failed(String errorCode, String errorMessage)
        {
        }
    }

    private static final class ChunkRowsPublisher implements QueryPublisher
    {
        private List<List<Object>> rows;
        private String errorCode;
        private String errorMessage;
        private Object engineState;

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
            this.rows = rows;
        }

        @Override
        public void resultSetRows(List<List<Object>> rows, List<OutputEvent> messages)
        {
        }

        @Override
        public void completed(long durationMs, long rowCount)
        {
        }

        @Override
        public void completed(long durationMs, long rowCount, Object engineState)
        {
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
        }
    }

    private static final class MessageCapturingPublisher implements QueryPublisher
    {
        private boolean completed;
        private final List<OutputEvent> capturedMessages = new ArrayList<>();

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
        }

        @Override
        public void resultSetRows(List<List<Object>> rows, List<OutputEvent> messages)
        {
            if (messages != null)
            {
                capturedMessages.addAll(messages);
            }
        }

        @Override
        public void completed(long durationMs, long rowCount)
        {
            completed = true;
        }

        @Override
        public void failed(String errorCode, String errorMessage)
        {
        }
    }
}
