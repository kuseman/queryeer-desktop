package com.queryeer.backend.plugin.payloadbuilder;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.QueryPublisher;

import se.kuseman.payloadbuilder.api.catalog.Column;
import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
import se.kuseman.payloadbuilder.api.catalog.Schema;
import se.kuseman.payloadbuilder.api.execution.Decimal;
import se.kuseman.payloadbuilder.api.execution.EpochDateTime;
import se.kuseman.payloadbuilder.api.execution.EpochDateTimeOffset;
import se.kuseman.payloadbuilder.api.execution.ObjectVector;
import se.kuseman.payloadbuilder.api.execution.TupleVector;
import se.kuseman.payloadbuilder.api.execution.ValueVector;

class PayloadbuilderQueryEngineProviderTest
{
    private static final ConfigService NOOP_CONFIG = key -> null;

    @Test
    void invokeEchoReturnsPayload()
    {
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG);

        Object result = provider.invoke("file-1", "payloadbuilder.echo", Map.of("hello", "world"));

        Assertions.assertNotNull(result);
        Assertions.assertTrue(result instanceof Map);
        Map<?, ?> asMap = (Map<?, ?>) result;
        Assertions.assertEquals("file-1", asMap.get("fileId"));
        Assertions.assertEquals(Map.of("hello", "world"), asMap.get("payload"));
    }

    @SuppressWarnings("unchecked")
    @Test
    void invokeCapabilitiesIncludesCatalogActions()
    {
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG);

        Object result = provider.invoke("file-1", "engine.capabilities", null);

        Assertions.assertTrue(result instanceof Map);
        Map<?, ?> asMap = (Map<?, ?>) result;
        Assertions.assertEquals(Set.of("engine.capabilities", "payloadbuilder.echo", "payloadbuilder.es.listIndices"), Set.copyOf((List<String>) asMap.get("actions")));
        Assertions.assertEquals(Set.of("elasticsearch", "filesystem"), Set.copyOf((Set<String>) asMap.get("catalogIds")));
    }

    @Test
    void invokeEsListIndicesRequiresEndpoint()
    {
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG);

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> provider.invoke("file-1", "payloadbuilder.es.listIndices", Map.of("properties", Map.of())));

        Assertions.assertEquals("endpoint is required for payloadbuilder.es.listIndices", error.getMessage());
    }

    @Test
    void invokeThrowsForUnsupportedAction()
    {
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG);

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> provider.invoke("file-1", "payloadbuilder.unknown", null));

        Assertions.assertEquals("Unsupported payloadbuilder action: payloadbuilder.unknown", error.getMessage());
    }

    @Test
    void executePublishesCompletionWithEngineStatePatch()
    {
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG);
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-2", "file-1", "select 1", null, publisher);

        Assertions.assertTrue(publisher.completedWithPatchCalled);
        Assertions.assertNull(publisher.completedEngineState);
        Assertions.assertNull(publisher.errorCode);
    }

    @Test
    void executeReturnsValidationFailureForMalformedEngineState()
    {
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG);
        RecordingPublisher publisher = new RecordingPublisher();
        Map<String, Object> malformed = Map.of("payloadbuilder", Map.of("catalogs", Map.of("jdbc1", "bad")));

        provider.execute("exec-1", "file-1", "select 1", malformed, publisher);

        Assertions.assertEquals("VALIDATION", publisher.errorCode);
        Assertions.assertEquals("Catalog instance for alias 'jdbc1' must be an object", publisher.errorMessage);
        Assertions.assertFalse(publisher.completed);
    }

    @Test
    void executeIncludesExceptionTypeInFailureMessage()
    {
        PayloadbuilderQueryEngineProvider provider = new PayloadbuilderQueryEngineProvider(NOOP_CONFIG);
        RecordingPublisher publisher = new RecordingPublisher();

        provider.execute("exec-3", "file-1", "select from", null, publisher);

        Assertions.assertEquals("INTERNAL", publisher.errorCode);
        Assertions.assertNotNull(publisher.errorMessage);
        Assertions.assertTrue(publisher.errorMessage.contains(":"));
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

    private static final class RecordingPublisher implements QueryPublisher
    {
        private boolean completed;
        private boolean completedWithPatchCalled;
        private Object completedEngineState;
        private String errorCode;
        private String errorMessage;

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
