package com.queryeer.backend.plugin.payloadbuilder;

import static java.util.Objects.requireNonNull;

import java.io.Writer;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.apache.commons.lang3.ObjectUtils;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.ErrorMessages;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.api.FileSessionHandler;
import com.queryeer.backend.api.OutputEvent;
import com.queryeer.backend.api.OutputSeverity;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.PayloadUtils;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.api.parse.IncrementalParseFunction;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;
import com.queryeer.backend.queryengine.sql.parser.SqlCompletionSupport;
import com.queryeer.backend.queryengine.sql.parser.TreeSitterSqlParseFunction;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.catalog.Column;
import se.kuseman.payloadbuilder.api.catalog.Schema;
import se.kuseman.payloadbuilder.api.execution.Decimal;
import se.kuseman.payloadbuilder.api.execution.EpochDateTime;
import se.kuseman.payloadbuilder.api.execution.EpochDateTimeOffset;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;
import se.kuseman.payloadbuilder.api.execution.ObjectVector;
import se.kuseman.payloadbuilder.api.execution.TupleVector;
import se.kuseman.payloadbuilder.api.execution.UTF8String;
import se.kuseman.payloadbuilder.api.execution.ValueVector;
import se.kuseman.payloadbuilder.core.Payloadbuilder;
import se.kuseman.payloadbuilder.core.RawQueryResult;
import se.kuseman.payloadbuilder.core.cache.InMemoryGenericCache;
import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.catalog.CoreColumn;
import se.kuseman.payloadbuilder.core.execution.QuerySession;
import se.kuseman.payloadbuilder.core.parser.Location;
import se.kuseman.payloadbuilder.core.parser.ParseException;

final class PayloadbuilderQueryEngineProvider implements QueryEngineProvider, FileSessionHandler
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
    private static final String ENV_MODULE_ID = "core.queryengine.payloadbuilder.environments";
    private static final String ENV_VALUES_KEY = "core.queryengine.payloadbuilder.environments.values";

    /** Shared generic cache between all sessions. Catalogs can store information that is reused. */
    private static final InMemoryGenericCache GENERIC_CACHE = new InMemoryGenericCache("QuerySession", true);
    private final Set<String> cancelledExecutionIds = ConcurrentHashMap.newKeySet();
    private final Map<String, QuerySession> activeSessions = new ConcurrentHashMap<>();
    private final ConfigService configService;
    private final PayloadbuilderCatalogProviderRegistry catalogProviders;
    private final PayloadMapper payloadMapper;
    private final IncrementalParseSessionService parseSessions;
    private final IncrementalParseFunction parseFunction;

    //@formatter:off
    PayloadbuilderQueryEngineProvider(
            ConfigService configService,
            PayloadMapper payloadMapper,
            PayloadbuilderCatalogProviderRegistry catalogProviders,
            IncrementalParseSessionService parseSessions,
            IncrementalParseFunction parseFunction)
    //@formatter:on
    {
        this.configService = requireNonNull(configService, "configService");
        this.payloadMapper = requireNonNull(payloadMapper, "payloadMapper");
        this.catalogProviders = requireNonNull(catalogProviders, "catalogProviders");
        this.parseSessions = requireNonNull(parseSessions, "parseSessions");
        this.parseFunction = requireNonNull(parseFunction, "parseFunction");
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
        AccumulatingOutputWriter outputWriter = new AccumulatingOutputWriter();
        try
        {
            PayloadbuilderEngineState typedState = payloadMapper.convert(engineState, PayloadbuilderEngineState.class);
            PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState catalogState = PayloadbuilderEngineStateSupport.parse(typedState);
            CatalogRegistry catalogRegistry = buildCatalogRegistry(catalogState);
            Map<String, Object> variables = resolveEnvironmentVariables(catalogState.selectedEnvironmentId());
            session = new QuerySession(catalogRegistry, variables);
            session.setGenericCache(GENERIC_CACHE);

            injectCatalogProperties(session, catalogState);

            session.setAbortSupplier(() -> cancelledExecutionIds.contains(queryExecutionId));
            activeSessions.put(queryExecutionId, session);

            PayloadbuilderEngineStateSupport.applyToSession(session, catalogState);

            session.setPrintWriter(outputWriter);
            session.setExceptionHandler(e -> outputWriter.addError(ErrorMessages.buildFailureMessage(e)));

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
                        // Flush any accumulated messages (from print statements, etc.)
                        // before processing the next batch of rows
                        outputWriter.flushMessages(publisher);

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
            outputWriter.flushMessages(publisher);
            Map<String, PayloadbuilderCatalogProviderContributor> providersByAlias = buildProvidersByAlias(catalogState);
            Object engineStatePatch = PayloadbuilderEngineStateSupport.buildEngineStatePatch(session, catalogState, providersByAlias);
            long total = System.currentTimeMillis() - startMs;
            publisher.completed(total, rowCount, engineStatePatch);
        }
        catch (IllegalArgumentException e)
        {
            outputWriter.flushMessages(publisher);
            publisher.failed("VALIDATION", ErrorMessages.buildFailureMessage(e));
        }
        catch (SecuritySessionClosedException e)
        {
            throw e;
        }
        catch (ParseException e)
        {
            outputWriter.flushMessages(publisher);
            publisher.failed("VALIDATION", e.getMessage(), parseErrorDetails(text, e));
        }
        catch (Exception e)
        {
            outputWriter.flushMessages(publisher);
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

    private static Map<String, Object> parseErrorDetails(String queryText, ParseException exception)
    {
        Location location = exception.getLocation();
        if (location == null
                || location.line() <= 0)
        {
            return Map.of();
        }
        int column = 1;
        if (queryText != null
                && location.startOffset() >= 0
                && location.startOffset() <= queryText.length())
        {
            int lineStartOffset = queryText.lastIndexOf('\n', Math.max(0, location.startOffset() - 1));
            column = location.startOffset() - lineStartOffset;
            if (column <= 0)
            {
                column = 1;
            }
        }
        return Map.of("line", location.line(), "column", column);
    }

    @Override
    public Object invoke(String fileId, String action, Object payload)
    {
        if ("sql.parse.snapshot".equals(action))
        {
            if (PayloadUtils.isBlank(fileId))
            {
                return Map.of();
            }
            return parseSessions.get(engineId(), fileId)
                    .map(snapshot -> Map.of("version", snapshot.version(), "languageId", snapshot.languageId(), "hasErrors", snapshot.hasErrors(), "attributes", snapshot.attributes()))
                    .orElseGet(Map::of);
        }
        if ("engine.capabilities".equals(action))
        {
            return Map.of("actions", mergeActions(), "catalogIds", catalogProviders.catalogIds());
        }
        if ("sql.complete".equals(action))
        {
            return sqlComplete(fileId, payload);
        }
        return catalogProviders.invoke(action, payload);
    }

    private Object sqlComplete(String fileId, Object payload)
    {
        return SqlCompletionSupport.complete(payloadMapper, parseSessions, engineId(), fileId, payload);
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

    private void injectCatalogProperties(IQuerySession querySession, PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        for (PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance instance : state.instancesByAlias()
                .values())
        {
            PayloadbuilderCatalogProviderContributor provider = catalogProviders.getCatalogProvider(instance.catalogId());
            if (provider != null)
            {
                provider.injectProperties(querySession, instance.alias(), instance.properties());
            }
        }
    }

    private Map<String, PayloadbuilderCatalogProviderContributor> buildProvidersByAlias(PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        Map<String, PayloadbuilderCatalogProviderContributor> result = new LinkedHashMap<>();
        for (PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance instance : state.instancesByAlias()
                .values())
        {
            PayloadbuilderCatalogProviderContributor provider = catalogProviders.getCatalogProvider(instance.catalogId());
            if (provider != null)
            {
                result.put(instance.alias(), provider);
            }
        }
        return result;
    }

    private Map<String, Object> resolveEnvironmentVariables(String selectedEnvironmentId)
    {
        if (selectedEnvironmentId == null)
        {
            return Map.of();
        }

        SettingsModule module = configService.getModule(ENV_MODULE_ID);
        if (module == null
                || module.values() == null)
        {
            return Map.of();
        }

        List<Environment> environments = payloadMapper.convertToList(module.values()
                .get(ENV_VALUES_KEY), Environment.class);
        Environment environment = environments.stream()
                .filter(env -> selectedEnvironmentId.equals(env.id))
                .findFirst()
                .orElse(null);
        if (environment == null)
        {
            return Map.of();
        }

        Map<String, Object> result = new HashMap<>(environment.variables.size());
        for (EnvironmentVariable envVar : environment.variables)
        {
            Object value;
            if (envVar.secretRef != null)
            {
                value = configService.materializeSecrets(envVar.secretRef);
            }
            else
            {
                value = envVar.value;
            }

            result.put(envVar.key, value);
        }
        return result;
    }

    private List<String> mergeActions()
    {
        List<String> actions = new ArrayList<>();
        actions.add("engine.capabilities");
        actions.add("sql.parse.snapshot");
        actions.add("sql.complete");
        actions.addAll(catalogProviders.actions());
        return actions;
    }

    @Override
    public void onOpen(FileSession session, String initialText)
    {
        parseSessions.open(engineId(), session.fileId(), session.backendVersion(), TreeSitterSqlParseFunction.LANGUAGE_SQL, initialText, parseFunction);
    }

    @Override
    public void onChange(FileSession session, long version, String text)
    {
        parseSessions.change(engineId(), session.fileId(), version, TreeSitterSqlParseFunction.LANGUAGE_SQL, text, parseFunction);
    }

    @Override
    public void onClose(FileSession session)
    {
        parseSessions.close(engineId(), session.fileId());
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

    static final class AccumulatingOutputWriter extends Writer
    {
        private final StringBuilder buffer = new StringBuilder();
        private final List<OutputEvent> messages = new ArrayList<>();

        AccumulatingOutputWriter()
        {
        }

        @Override
        public void write(char[] cbuf, int off, int len)
        {
            buffer.append(cbuf, off, len);
            flushLines();
        }

        @Override
        public void flush()
        {
            flushLines();
        }

        @Override
        public void close()
        {
            flushLines();
        }

        void addError(String message)
        {
            messages.add(new OutputEvent(OutputSeverity.ERROR, message));
        }

        void flushMessages(QueryPublisher publisher)
        {
            flushLines();
            if (!messages.isEmpty())
            {
                List<OutputEvent> batch = List.copyOf(messages);
                messages.clear();
                publisher.resultSetRows(List.of(), batch);
            }
        }

        private void flushLines()
        {
            String content = buffer.toString();
            int idx;
            while ((idx = content.indexOf('\n')) >= 0)
            {
                String line = content.substring(0, idx)
                        .stripTrailing();
                if (!line.isEmpty())
                {
                    messages.add(new OutputEvent(OutputSeverity.INFO, line));
                }
                content = content.substring(idx + 1);
            }
            buffer.setLength(0);
            buffer.append(content);
        }
    }

    private record Environment(String id, String title, List<EnvironmentVariable> variables)
    {
        @SuppressWarnings("unused")
        Environment
        {
            variables = ObjectUtils.getIfNull(variables, List.of());
        }
    }

    private record EnvironmentVariable(String key, String value, Object secretRef)
    {
    }

}
