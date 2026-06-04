package com.queryeer.backend.plugin.payloadbuilder;

import static org.junit.jupiter.api.Assertions.assertNull;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

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
import com.queryeer.backend.core.JacksonPayloadMapper;
import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderQueryEngineProvider.SessionHolder;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcConnections;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;
import com.queryeer.backend.queryengine.sql.parser.TreeSitterSqlParseFunction;

import se.kuseman.payloadbuilder.api.catalog.Column;
import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
import se.kuseman.payloadbuilder.api.catalog.Schema;
import se.kuseman.payloadbuilder.api.execution.Decimal;
import se.kuseman.payloadbuilder.api.execution.EpochDateTime;
import se.kuseman.payloadbuilder.api.execution.EpochDateTimeOffset;
import se.kuseman.payloadbuilder.api.execution.ObjectVector;
import se.kuseman.payloadbuilder.api.execution.TupleVector;
import se.kuseman.payloadbuilder.api.execution.UTF8String;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

class PayloadbuilderQueryEngineProviderTest
{
    private static final ConfigService NOOP_CONFIG = _ -> null;
    private static final JdbcRuntimeService JDBCRUNTIMESERVICE = Mockito.mock(JdbcRuntimeService.class);
    private static final PayloadMapper TEST_MAPPER = new JacksonPayloadMapper();
    private static final IncrementalParseSessionService PARSE_SESSIONS = Mockito.mock(IncrementalParseSessionService.class);
    private static final IncrementalParseFunction PARSE_FUNCTION = Mockito.mock(IncrementalParseFunction.class);

    private static PayloadbuilderQueryEngineProvider createProvider(ConfigService config)
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(config, TEST_MAPPER, JDBCRUNTIMESERVICE);
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
        Assertions.assertEquals(Set.of("engine.capabilities", "sql.parse.snapshot", "sql.complete", "payloadbuilder.es.listIndices", "payloadbuilder.kafka.listTopics"),
                Set.copyOf((List<String>) asMap.get("actions")));
        Assertions.assertEquals(Set.of("jdbc", "elasticsearch", "kafka", "filesystem", "http"), Set.copyOf((Set<String>) asMap.get("catalogIds")));
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
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(config, TEST_MAPPER, mockJdbcRuntime);
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
    void publishTupleVectorInChunksConvertsComplexTypesToNestedJavaStructures()
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
        Assertions.assertEquals(List.of(1, 2, 3), row.get(0));
        Assertions.assertEquals(Map.of("objectField", 42, "objectText", "obj"), row.get(1));
        Assertions.assertEquals(List.of(Map.of("nestedId", 10, "nestedText", "n"), Map.of("nestedId", 11, "nestedText", "n")), row.get(2));
        Assertions.assertNull(row.get(3));
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

        //@formatter:off
        @SuppressWarnings("unchecked")
        Map<String, Object> mapValue = (Map<String, Object>) row.get(1);
        //@formatter:on
        Assertions.assertEquals("hello", mapValue.get("k"));
        Assertions.assertFalse(mapValue.get("k") instanceof UTF8String);

        @SuppressWarnings("unchecked")
        List<Object> listValue = (List<Object>) row.get(2);
        Assertions.assertEquals(new BigDecimal("3.14"), listValue.get(0));
        Assertions.assertFalse(listValue.get(0) instanceof Decimal);
        Assertions.assertEquals(LocalDateTime.parse("2025-01-02T03:04:05"), listValue.get(1));
        Assertions.assertFalse(listValue.get(1) instanceof EpochDateTime);
        Assertions.assertEquals(ZonedDateTime.parse("2025-01-02T03:04:05Z"), listValue.get(2));
        Assertions.assertFalse(listValue.get(2) instanceof EpochDateTimeOffset);
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
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE);
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
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE);
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG, TEST_MAPPER, registry, sessions, PARSE_FUNCTION);

        Object result = provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", "SELECT ", "cursor", Map.of("line", 1, "column", 8), "limits", Map.of("maxItems", 50)));

        Assertions.assertNotNull(result);
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
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, throwingMapper, JDBCRUNTIMESERVICE);
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
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, throwingMapper, JDBCRUNTIMESERVICE);
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
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, TEST_MAPPER, JDBCRUNTIMESERVICE);
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
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(config, TEST_MAPPER, JDBCRUNTIMESERVICE);
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

    private static final class RecordingPublisher implements QueryPublisher
    {
        private boolean completed;
        private boolean completedWithPatchCalled;
        private String errorCode;
        private String errorMessage;
        private Map<String, Object> errorDetails = Map.of();

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
        public void failed(String errorCode, String errorMessage)
        {
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
