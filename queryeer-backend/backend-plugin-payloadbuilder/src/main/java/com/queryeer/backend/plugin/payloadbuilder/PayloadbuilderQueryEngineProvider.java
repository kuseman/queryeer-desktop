package com.queryeer.backend.plugin.payloadbuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.ErrorMessages;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.contract.payloadbuilder.PayloadbuilderEngineState;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.catalog.Column;
import se.kuseman.payloadbuilder.api.catalog.Schema;
import se.kuseman.payloadbuilder.api.execution.Decimal;
import se.kuseman.payloadbuilder.api.execution.EpochDateTime;
import se.kuseman.payloadbuilder.api.execution.EpochDateTimeOffset;
import se.kuseman.payloadbuilder.api.execution.ObjectVector;
import se.kuseman.payloadbuilder.api.execution.TupleVector;
import se.kuseman.payloadbuilder.api.execution.UTF8String;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.core.Payloadbuilder;
import se.kuseman.payloadbuilder.core.RawQueryResult;
import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.catalog.CoreColumn;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

public final class PayloadbuilderQueryEngineProvider implements QueryEngineProvider
{
    static final int ROW_CHUNK_SIZE = 100;
    private static final String TYPE_STRING = "string";
    private static final String TYPE_BOOLEAN = "boolean";
    private static final String TYPE_INT = "int";
    private static final String TYPE_LONG = "long";
    private static final String TYPE_DECIMAL = "decimal";
    private static final String TYPE_FLOAT = "float";
    private static final String TYPE_DOUBLE = "double";
    private static final String TYPE_DATETIME = "datetime";
    private static final String TYPE_DATETIMEOFFSET = "datetimeoffset";
    private static final String TYPE_OBJECT = "object";
    private static final String TYPE_ARRAY = "array";
    private static final String TYPE_TABLE = "table";
    private static final String TYPE_ANY = "any";

    private final Set<String> cancelledExecutionIds = ConcurrentHashMap.newKeySet();
    private final Map<String, QuerySession> activeSessions = new ConcurrentHashMap<>();
    private final PayloadbuilderCatalogProviderRegistry catalogProviders;
    private final PayloadMapper payloadMapper;

    public PayloadbuilderQueryEngineProvider(ConfigService configService, PayloadMapper payloadMapper)
    {
        this.payloadMapper = payloadMapper;
        this.catalogProviders = PayloadbuilderCatalogProviderRegistry.defaults(configService, payloadMapper);
    }

    @Override
    public String engineId()
    {
        return "payloadbuilder";
    }

    @Override
    public void execute(String queryExecutionId, String fileId, String text, Object engineState, QueryPublisher publisher)
    {
        long startMs = System.currentTimeMillis();
        QuerySession session = null;
        try
        {
            PayloadbuilderEngineState typedState = payloadMapper.convert(engineState, PayloadbuilderEngineState.class);
            PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState catalogState = PayloadbuilderEngineStateSupport.parse(typedState);
            catalogState = resolveCatalogConnections(catalogState);
            CatalogRegistry catalogRegistry = buildCatalogRegistry(catalogState);
            session = new QuerySession(catalogRegistry);
            session.setAbortSupplier(() -> cancelledExecutionIds.contains(queryExecutionId));
            activeSessions.put(queryExecutionId, session);

            PayloadbuilderEngineStateSupport.applyToSession(session, catalogState);

            RawQueryResult result = Payloadbuilder.compile(session, text)
                    .executeRaw(session);

            long rowCount = 0;
            while (result.hasMoreResults())
            {
                RowCountCollector rowCounter = new RowCountCollector();
                result.consumeResult(new RawQueryResult.ResultConsumer()
                {
                    private boolean started;

                    @Override
                    public void schema(Schema schema)
                    {
                    }

                    @Override
                    public boolean consume(TupleVector tupleVector)
                    {
                        // Always use the runtime schema here
                        if (!started)
                        {
                            started = true;
                            Schema schema = tupleVector.getSchema();
                            publisher.resultSetStart(toColumnNames(schema), toColumnTypes(schema));
                        }

                        if (tupleVector == null
                                || tupleVector.getRowCount() == 0)
                        {
                            return true;
                        }
                        rowCounter.value += publishTupleVectorInChunks(publisher, tupleVector, ROW_CHUNK_SIZE);
                        return !cancelledExecutionIds.contains(queryExecutionId);
                    }
                });
                rowCount += rowCounter.value;
            }
            Object engineStatePatch = PayloadbuilderEngineStateSupport.buildEngineStatePatch(session, catalogState);
            publisher.completed(System.currentTimeMillis() - startMs, rowCount, engineStatePatch);
        }
        catch (IllegalArgumentException e)
        {
            publisher.failed("VALIDATION", e.getMessage());
        }
        catch (Exception e)
        {
            if (cancelledExecutionIds.contains(queryExecutionId))
            {
                publisher.failed("CANCELLED", "Execution cancelled by client");
            }
            else
            {
                publisher.failed("INTERNAL", ErrorMessages.buildFailureMessage(e));
            }
        }
        finally
        {
            cancelledExecutionIds.remove(queryExecutionId);
            if (session != null)
            {
                activeSessions.remove(queryExecutionId);
            }
        }
    }

    @Override
    public Object invoke(String fileId, String action, Object payload)
    {
        if ("engine.capabilities".equals(action))
        {
            return Map.of("actions", mergeActions(), "catalogIds", catalogProviders.catalogIds());
        }
        if ("payloadbuilder.echo".equals(action))
        {
            return Map.of("fileId", fileId, "payload", payload);
        }
        return catalogProviders.invoke(action, payload);
    }

    private CatalogRegistry buildCatalogRegistry(PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        CatalogRegistry registry = new CatalogRegistry();
        for (PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance instance : state.instancesByAlias()
                .values())
        {
            Catalog catalog = catalogProviders.createCatalog(instance.catalogId());
            if (catalog != null)
            {
                registry.registerCatalog(instance.alias(), catalog);
            }
        }
        return registry;
    }

    private PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState resolveCatalogConnections(PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        Map<String, PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance> resolved = new java.util.LinkedHashMap<>();
        for (PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance instance : state.instancesByAlias()
                .values())
        {
            String connectionId = stringValue(instance.properties()
                    .get("connectionId"));
            if (connectionId != null)
            {
                Map<String, Object> connProperties = catalogProviders.resolveConnection(instance.catalogId(), connectionId);
                if (!connProperties.isEmpty())
                {
                    Map<String, Object> merged = new java.util.LinkedHashMap<>(connProperties);
                    merged.putAll(instance.properties());
                    String alias = instance.alias();
                    resolved.put(alias, new PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance(alias, instance.catalogId(), merged));
                    continue;
                }
            }
            resolved.put(instance.alias(), instance);
        }
        return new PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState(state.defaultCatalogAlias(), resolved);
    }

    private static String stringValue(Object value)
    {
        if (value instanceof String s)
        {
            String trimmed = s.trim();
            return trimmed.isEmpty() ? null
                    : trimmed;
        }
        return null;
    }

    private List<String> mergeActions()
    {
        List<String> actions = new ArrayList<>();
        actions.add("engine.capabilities");
        actions.add("payloadbuilder.echo");
        actions.addAll(catalogProviders.actions());
        return actions;
    }

    static int publishTupleVectorInChunks(QueryPublisher publisher, TupleVector tupleVector, int chunkSize)
    {
        if (tupleVector == null
                || tupleVector.getRowCount() == 0)
        {
            return 0;
        }

        int effectiveChunkSize = Math.max(1, chunkSize);
        int rowCount = 0;
        int columnCount = tupleVector.getSchema()
                .getSize();
        List<List<Object>> batch = new ArrayList<>(effectiveChunkSize);
        for (int rowIndex = 0; rowIndex < tupleVector.getRowCount(); rowIndex++)
        {
            List<Object> row = new ArrayList<>(columnCount);
            for (int columnIndex = 0; columnIndex < columnCount; columnIndex++)
            {
                row.add(rowValueAsSerializableObject(tupleVector.getColumn(columnIndex), rowIndex));
            }
            batch.add(row);
            if (batch.size() == effectiveChunkSize)
            {
                publisher.resultSetRows(batch);
                rowCount += batch.size();
                batch = new ArrayList<>(effectiveChunkSize);
            }
        }

        if (!batch.isEmpty())
        {
            publisher.resultSetRows(batch);
            rowCount += batch.size();
        }

        return rowCount;
    }

    static Object rowValueAsSerializableObject(ValueVector valueVector, int rowIndex)
    {
        if (valueVector.isNull(rowIndex))
        {
            return null;
        }

        Column.Type type = valueVector.type()
                .getType();
        if (type == Column.Type.Table)
        {
            return toTableRows(valueVector.getTable(rowIndex));
        }
        if (type == Column.Type.Array)
        {
            return toArrayValues(valueVector.getArray(rowIndex));
        }
        if (type == Column.Type.Object)
        {
            return toObjectMap(valueVector.getObject(rowIndex));
        }
        if (type == Column.Type.String)
        {
            return valueVector.getString(rowIndex)
                    .toString();
        }
        if (type == Column.Type.Boolean)
        {
            return valueVector.getBoolean(rowIndex);
        }
        if (type == Column.Type.Int)
        {
            return valueVector.getInt(rowIndex);
        }
        if (type == Column.Type.Long)
        {
            return valueVector.getLong(rowIndex);
        }
        if (type == Column.Type.Decimal)
        {
            return valueVector.getDecimal(rowIndex)
                    .asBigDecimal();
        }
        if (type == Column.Type.Float)
        {
            return valueVector.getFloat(rowIndex);
        }
        if (type == Column.Type.Double)
        {
            return valueVector.getDouble(rowIndex);
        }
        if (type == Column.Type.DateTime)
        {
            return valueVector.getDateTime(rowIndex)
                    .getLocalDateTime();
        }
        if (type == Column.Type.DateTimeOffset)
        {
            return valueVector.getDateTimeOffset(rowIndex)
                    .getZonedDateTime();
        }
        if (type == Column.Type.Any)
        {
            return normalizeAnyValue(valueVector.getAny(rowIndex));
        }

        return normalizeAnyValue(valueVector.valueAsObject(rowIndex));
    }

    private static List<Map<String, Object>> toTableRows(TupleVector table)
    {
        List<Map<String, Object>> rows = new ArrayList<>(table.getRowCount());
        int columnCount = table.getSchema()
                .getSize();
        for (int rowIndex = 0; rowIndex < table.getRowCount(); rowIndex++)
        {
            Map<String, Object> row = new java.util.LinkedHashMap<>(columnCount);
            for (int columnIndex = 0; columnIndex < columnCount; columnIndex++)
            {
                String name = table.getSchema()
                        .getColumns()
                        .get(columnIndex)
                        .getName();
                row.put(name, rowValueAsSerializableObject(table.getColumn(columnIndex), rowIndex));
            }
            rows.add(row);
        }
        return rows;
    }

    private static List<Object> toArrayValues(ValueVector arrayVector)
    {
        List<Object> values = new ArrayList<>(arrayVector.size());
        for (int i = 0; i < arrayVector.size(); i++)
        {
            values.add(rowValueAsSerializableObject(arrayVector, i));
        }
        return values;
    }

    private static Map<String, Object> toObjectMap(ObjectVector object)
    {
        int columnCount = object.getSchema()
                .getSize();
        Map<String, Object> values = new java.util.LinkedHashMap<>(columnCount);
        int rowIndex = object.getRow();
        for (int columnIndex = 0; columnIndex < columnCount; columnIndex++)
        {
            String name = object.getSchema()
                    .getColumns()
                    .get(columnIndex)
                    .getName();
            values.put(name, rowValueAsSerializableObject(object.getValue(columnIndex), rowIndex));
        }
        return values;
    }

    private static Object normalizeAnyValue(Object value)
    {
        if (value == null)
        {
            return null;
        }
        if (value instanceof TupleVector table)
        {
            return toTableRows(table);
        }
        if (value instanceof ObjectVector object)
        {
            return toObjectMap(object);
        }
        if (value instanceof UTF8String s)
        {
            return s.toString();
        }
        if (value instanceof Decimal d)
        {
            return d.asBigDecimal();
        }
        if (value instanceof EpochDateTime d)
        {
            return d.getLocalDateTime();
        }
        if (value instanceof EpochDateTimeOffset d)
        {
            return d.getZonedDateTime();
        }

        // NOTE! We need to check ValueVector last since UTF8String/Decimal/EpochDateTime/EpochDateTimeOffset implements that interface
        if (value instanceof ValueVector v)
        {
            return toArrayValues(v);
        }
        return value;
    }

    private static List<String> toColumnNames(Schema schema)
    {
        List<String> names = new ArrayList<>(schema.getSize());
        for (int i = 0; i < schema.getSize(); i++)
        {
            Column column = schema.getColumns()
                    .get(i);
            String columnName = column instanceof CoreColumn cc ? cc.getOutputName()
                    : column.getName();
            names.add(columnName);
        }
        return names;
    }

    private static List<String> toColumnTypes(Schema schema)
    {
        List<String> types = new ArrayList<>(schema.getSize());
        for (int i = 0; i < schema.getSize(); i++)
        {
            types.add(toContractColumnType(schema.getColumns()
                    .get(i)
                    .getType()
                    .getType()));
        }
        return types;
    }

    private static String toContractColumnType(Column.Type type)
    {
        if (type == Column.Type.String)
        {
            return TYPE_STRING;
        }
        if (type == Column.Type.Boolean)
        {
            return TYPE_BOOLEAN;
        }
        if (type == Column.Type.Int)
        {
            return TYPE_INT;
        }
        if (type == Column.Type.Long)
        {
            return TYPE_LONG;
        }
        if (type == Column.Type.Decimal)
        {
            return TYPE_DECIMAL;
        }
        if (type == Column.Type.Float)
        {
            return TYPE_FLOAT;
        }
        if (type == Column.Type.Double)
        {
            return TYPE_DOUBLE;
        }
        if (type == Column.Type.DateTime)
        {
            return TYPE_DATETIME;
        }
        if (type == Column.Type.DateTimeOffset)
        {
            return TYPE_DATETIMEOFFSET;
        }
        if (type == Column.Type.Object)
        {
            return TYPE_OBJECT;
        }
        if (type == Column.Type.Array)
        {
            return TYPE_ARRAY;
        }
        if (type == Column.Type.Table)
        {
            return TYPE_TABLE;
        }
        if (type == Column.Type.Any)
        {
            return TYPE_ANY;
        }
        return TYPE_ANY;
    }

    @Override
    public void cancel(String queryExecutionId)
    {
        cancelledExecutionIds.add(queryExecutionId);
        QuerySession session = activeSessions.get(queryExecutionId);
        if (session != null)
        {
            session.fireAbortQueryListeners();
        }
    }

    static final class RowCountCollector
    {
        long value;
    }

}
