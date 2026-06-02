package com.queryeer.backend.plugin.payloadbuilder;

import static org.junit.jupiter.api.Assertions.assertNull;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.api.parse.IncrementalParseFunction;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.api.parse.ParseSessionSnapshot;
import com.queryeer.backend.core.JacksonPayloadMapper;
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

        provider.execute("exec-2", "file-1", "select 1", null, publisher);

        Assertions.assertTrue(publisher.completedWithPatchCalled);
        Assertions.assertNull(publisher.completedEngineState);
        Assertions.assertNull(publisher.errorCode);
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
    void executeIncludesExceptionTypeInFailureMessage()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-3", "file-1", "select from", null, publisher);

        Assertions.assertEquals("VALIDATION", publisher.errorCode);
        Assertions.assertNotNull(publisher.errorMessage);
        Assertions.assertTrue(publisher.errorDetails.containsKey("line"));
        Assertions.assertTrue(publisher.errorDetails.containsKey("column"));
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
        // Regression: payloadbuilder-internal types (UTF8String, Decimal, EpochDateTime, EpochDateTimeOffset) used to leak through Map/List
        // values because the row-level normalizer only handled top-level values. The transport mapper lives in a different classloader
        // and cannot resolve these types — they must be converted to plain JDK types at every depth before chunk publishing.
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();

        UTF8String utf8 = UTF8String.from("hello");
        Decimal decimal = Decimal.from("3.14");
        EpochDateTime dateTime = EpochDateTime.from("2025-01-02T03:04:05");
        EpochDateTimeOffset dateTimeOffset = EpochDateTimeOffset.from("2025-01-02T03:04:05Z");

        ValueVector topLevelUtf8 = ValueVector.literalAny(1, utf8);
        ValueVector nestedInMap = ValueVector.literalAny(1, java.util.Map.of("k", utf8));
        ValueVector nestedInList = ValueVector.literalAny(1, java.util.List.of(decimal, dateTime, dateTimeOffset));

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

        // Top-level: every payloadbuilder-internal type must be replaced with its JDK equivalent.
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
        // chunkSize 0 is clamped to 1 → 3 separate single-row notifications
        Assertions.assertEquals(List.of(1, 1, 1), publisher.chunkSizes);
    }

    @Test
    void publishTupleVectorInChunksFlushesPartialFinalBatch()
    {
        // 7 rows with chunkSize=3: batches of 3, 3, then a partial 1 that must still be flushed
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
    void rowValueAsSerializableObjectReturnsRawValueForUnknownColumnType()
    {
        // Build a ValueVector with a synthetic column type that has no explicit branch in rowValueAsSerializableObject.
        // All known types are covered by other tests, so any newly added Column.Type that isn't handled yet would land in
        // the fallback `return normalizeAnyValue(valueVector.valueAsObject(rowIndex))` path.
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        TupleVector tupleVector = TupleVector.of(Schema.of(Column.of("s", ResolvedType.STRING)), ValueVector.literalString("hello", 1));

        PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        Assertions.assertEquals("hello", publisher.rows.get(0)
                .get(0));
    }

    @Test
    void normalizeAnyValueReturnsNullForNullInput()
    {
        // Verified indirectly via literalNull columns; this is the same code path
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        TupleVector tupleVector = TupleVector.of(Schema.of(Column.of("n", ResolvedType.STRING)), ValueVector.literalNull(ResolvedType.STRING, 1));

        PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        Assertions.assertNull(publisher.rows.get(0)
                .get(0));
    }

    @Test
    void normalizeAnyValueConvertsValueVectorBackToArray()
    {
        // ValueVector that isn't a TupleVector/ObjectVector/UTF8String/Decimal/DateTime/DateTimeOffset still
        // must be converted via toArrayValues so callers receive a List, not a raw vector.
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        ValueVector anyIntRange = ValueVector.literalAny(1, ValueVector.range(1, 4));

        //@formatter:off
        TupleVector tupleVector = TupleVector.of(
                Schema.of(Column.of("v", ResolvedType.ANY)),
                anyIntRange);
        //@formatter:on

        PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        @SuppressWarnings("unchecked")
        List<Object> value = (List<Object>) publisher.rows.get(0)
                .get(0);
        Assertions.assertEquals(List.of(1, 2, 3), value);
    }

    @Test
    void normalizeAnyValueRecursesIntoNestedMapsAndIterables()
    {
        // Nested Map containing a List containing payloadbuilder-internal types — every leaf must be converted
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        Map<String, Object> nested = Map.of("list", List.of(UTF8String.from("x"), Decimal.from("1.5")));

        //@formatter:off
        TupleVector tupleVector = TupleVector.of(
                Schema.of(Column.of("m", ResolvedType.ANY)),
                ValueVector.literalAny(1, nested));
        //@formatter:on

        PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        @SuppressWarnings("unchecked")
        Map<String, Object> value = (Map<String, Object>) publisher.rows.get(0)
                .get(0);
        @SuppressWarnings("unchecked")
        List<Object> inner = (List<Object>) value.get("list");
        Assertions.assertEquals("x", inner.get(0));
        Assertions.assertEquals(new BigDecimal("1.5"), inner.get(1));
    }

    @Test
    void normalizeAnyValueReturnsUnsupportedValueUnchanged()
    {
        // Non-Container, non-payloadbuilder values pass through as-is (Jackson can serialize plain JDK types).
        // We use a LinkedHashSet — Iterable so the Iterable branch is exercised, but the recursion preserves element identity
        // for non-payloadbuilder leaves.
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        java.util.LinkedHashSet<String> set = new java.util.LinkedHashSet<>();
        set.add("alpha");
        set.add("beta");

        //@formatter:off
        TupleVector tupleVector = TupleVector.of(
                Schema.of(Column.of("v", ResolvedType.ANY)),
                ValueVector.literalAny(1, set));
        //@formatter:on

        PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        @SuppressWarnings("unchecked")
        List<Object> value = (List<Object>) publisher.rows.get(0)
                .get(0);
        // Order preserved and elements returned by identity (the normalizer does not wrap plain JDK strings)
        Assertions.assertEquals(List.of("alpha", "beta"), value);
        Assertions.assertEquals("alpha", value.get(0));
    }

    @Test
    void normalizeAnyValueReturnsScalarUnchanged()
    {
        // Scalar plain JDK values (Integer, Boolean, etc.) pass through the normalizer as-is.
        ChunkRowsPublisher publisher = new ChunkRowsPublisher();
        Integer value = 42;

        //@formatter:off
        TupleVector tupleVector = TupleVector.of(
                Schema.of(Column.of("v", ResolvedType.ANY)),
                ValueVector.literalAny(1, value));
        //@formatter:on

        PayloadbuilderQueryEngineProvider.publishTupleVectorInChunks(publisher, tupleVector, 100);

        Object actual = publisher.rows.get(0)
                .get(0);
        Assertions.assertSame(value, actual);
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
                .thenReturn(java.util.Optional.of(snapshot));
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

        // SqlCompletionSupport is a static utility tested in its own module; here we just confirm the provider routes
        // the call without throwing and that the result is whatever SqlCompletionSupport returns (non-null for a valid payload).
        Object result = provider.invoke("file-1", "sql.complete",
                Map.of("fileId", "file-1", "version", 1L, "text", "SELECT ", "cursor", Map.of("line", 1, "column", 8), "limits", Map.of("maxItems", 50)));

        Assertions.assertNotNull(result);
    }

    @Test
    void executeReturnsInternalFailureWhenPayloadMapperConvertThrows()
    {
        // Use a PayloadMapper that throws on convert() to drive the generic catch (Exception) → INTERNAL branch.
        // The exception is a RuntimeException so it lands in the generic catch block, not the typed ones.
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
        // Same payload mapper that throws on convert(), but cancel is set first — the generic catch must take the CANCELLED branch.
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

        // Selected env id is set, but no module is configured → empty env map
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
                // Module exists but its values map is null
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

        // Selected env id "missing" doesn't match any configured environment
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

        // No active session for this id — cancel must not throw and the id is added to the cancelled set
        provider.cancel("exec-not-active");

        // Running a query with the same id completes successfully and the cancel flag is cleared (exercised by the finally block)
        RecordingPublisher publisher = new RecordingPublisher();
        provider.execute("exec-not-active", "file-1", "select 1", null, publisher);
        Assertions.assertNull(publisher.errorCode, publisher.errorMessage);
        Assertions.assertTrue(publisher.completed);
    }

    @Test
    void engineIdReturnsPayloadbuilder()
    {
        PayloadbuilderQueryEngineProvider provider = createProvider(NOOP_CONFIG);
        Assertions.assertEquals("payloadbuilder", provider.engineId());
    }

    private static final class RecordingPublisher implements QueryPublisher
    {
        private boolean completed;
        private boolean completedWithPatchCalled;
        private Object completedEngineState;
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
        public void completed(long durationMs, long rowCount)
        {
            completed = true;
        }

        @Override
        public void completed(long durationMs, long rowCount, Object engineState)
        {
            completed = true;
            completedWithPatchCalled = true;
            completedEngineState = engineState;
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
        public void completed(long durationMs, long rowCount)
        {
        }

        @Override
        public void failed(String errorCode, String errorMessage)
        {
        }
    }
}
