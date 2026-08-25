package com.queryeer.backend.plugin.payloadbuilder;

import static java.util.Objects.requireNonNull;

import java.io.IOException;
import java.io.Writer;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;

import org.apache.commons.lang3.ObjectUtils;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.ErrorMessages;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.api.FileSessionHandler;
import com.queryeer.backend.api.LargeValueStore;
import com.queryeer.backend.api.LargeValueWriter;
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
import com.queryeer.backend.queryengine.sql.parser.TreeSitterSqlParseFunction;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.catalog.Column;
import se.kuseman.payloadbuilder.api.catalog.ResolvedType;
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
    private static final String LARGE_TYPE_JSON = "json";
    private static final String LARGE_TYPE_TEXT = "text";
    private static final String CONTENT_TYPE_JSON = "application/json";
    private static final String CONTENT_TYPE_TEXT = "text/plain";
    private static final String METADATA_KEY_EXECUTION_TIME = "Execution Time";
    private static final String ENV_MODULE_ID = "core.queryengine.payloadbuilder.environments";
    private static final String ENV_VALUES_KEY = "core.queryengine.payloadbuilder.environments.values";

    /** Shared generic cache between all sessions. Catalogs can store information that is reused. */
    private static final InMemoryGenericCache GENERIC_CACHE = new InMemoryGenericCache("QuerySession", true);
    private final AtomicLong sessionCounter = new AtomicLong(0);
    private final Set<String> cancelledExecutionIds = ConcurrentHashMap.newKeySet();
    private final Map<String, FileSessionHolder> sessionByFileId = new ConcurrentHashMap<>();
    final Map<String, SessionHolder> sessionByExecutionId = new ConcurrentHashMap<>();
    private final ConfigService configService;
    private final PayloadbuilderCatalogProviderRegistry catalogProviders;
    private final PayloadMapper payloadMapper;
    private final LargeValueStore largeValueStore;
    private final IncrementalParseSessionService parseSessions;
    private final IncrementalParseFunction parseFunction;
    private final PayloadbuilderSqlSemanticHandler sqlSemanticHandler;

    //@formatter:off
    PayloadbuilderQueryEngineProvider(
            ConfigService configService,
            PayloadMapper payloadMapper,
            PayloadbuilderCatalogProviderRegistry catalogProviders,
            IncrementalParseSessionService parseSessions,
            IncrementalParseFunction parseFunction)
    //@formatter:on
    {
        this(configService, payloadMapper, catalogProviders, parseSessions, parseFunction, LargeValueStore.inlineOnly());
    }

    //@formatter:off
    PayloadbuilderQueryEngineProvider(
            ConfigService configService,
            PayloadMapper payloadMapper,
            PayloadbuilderCatalogProviderRegistry catalogProviders,
            IncrementalParseSessionService parseSessions,
            IncrementalParseFunction parseFunction,
            LargeValueStore largeValueStore)
    //@formatter:on
    {
        this.configService = requireNonNull(configService, "configService");
        this.payloadMapper = requireNonNull(payloadMapper, "payloadMapper");
        this.catalogProviders = requireNonNull(catalogProviders, "catalogProviders");
        this.largeValueStore = requireNonNull(largeValueStore, "largeValueStore");
        this.parseSessions = requireNonNull(parseSessions, "parseSessions");
        this.parseFunction = requireNonNull(parseFunction, "parseFunction");
        this.sqlSemanticHandler = new PayloadbuilderSqlSemanticHandler(payloadMapper, parseSessions, engineId(), catalogProviders);
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
        String sessionId = null;
        FileSessionHolder fileSessionHolder = null;
        boolean fileSessionLocked = false;
        AccumulatingOutputWriter outputWriter = new AccumulatingOutputWriter();
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState catalogState = null;
        Map<String, ValueVector> previousEnvironmentVariables = Map.of();
        try
        {
            PayloadbuilderEngineState typedState = payloadMapper.convert(engineState, PayloadbuilderEngineState.class);
            if (typedState == null)
            {
                throw new IllegalArgumentException("Engine state is required");
            }
            catalogState = PayloadbuilderEngineStateSupport.parse(typedState);
            fileSessionHolder = sessionByFileId.computeIfAbsent(fileId, _ -> new FileSessionHolder());
            fileSessionHolder.lock.lock();
            fileSessionLocked = true;
            SessionHolder holder = getOrCreateSessionHolder(fileSessionHolder, catalogState);
            session = holder.session;
            sessionId = holder.sessionId;

            previousEnvironmentVariables = injectEnvironmentVariables(session, catalogState.selectedEnvironmentId());
            injectCatalogProperties(session, catalogState);

            session.setAbortSupplier(() -> cancelledExecutionIds.contains(queryExecutionId));
            sessionByExecutionId.put(queryExecutionId, holder);

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
                            Map<String, String> metadata = Map.of(METADATA_KEY_EXECUTION_TIME, LocalDateTime.now()
                                    .toString());
                            Schema schema = tupleVector.getSchema();
                            publisher.resultSetStart(toColumnNames(schema), toColumnTypes(schema), metadata);
                        }

                        if (tupleVector == null
                                || tupleVector.getRowCount() == 0)
                        {
                            return true;
                        }
                        rowCounter.value += publishTupleVectorInChunks(publisher, tupleVector, ROW_CHUNK_SIZE, largeValueStore, queryExecutionId);
                        return !cancelledExecutionIds.contains(queryExecutionId);
                    }
                });
                rowCount += rowCounter.value;
            }
            outputWriter.flushMessages(publisher);
            Map<String, PayloadbuilderCatalogProviderContributor> providersByAlias = buildProvidersByAlias(catalogState);
            Object engineStatePatch = PayloadbuilderEngineStateSupport.buildEngineStatePatch(session, catalogState, providersByAlias, sessionId);
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
            sessionByExecutionId.remove(queryExecutionId);
            try
            {
                if (catalogState != null
                        && session != null)
                {
                    try
                    {
                        clearExecutionCatalogProperties(session, catalogState);
                    }
                    finally
                    {
                        restoreEnvironmentVariables(session, previousEnvironmentVariables);
                    }
                }
            }
            finally
            {
                if (fileSessionLocked)
                {
                    fileSessionHolder.lock.unlock();
                }
            }
        }
    }

    private SessionHolder getOrCreateSessionHolder(FileSessionHolder fileSessionHolder, PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState catalogState)
    {
        CatalogTopologyKey catalogTopologyKey = catalogTopologyKey(catalogState);
        SessionHolder existing = fileSessionHolder.sessionHolder;
        if (existing != null
                && Objects.equals(existing.catalogTopologyKey(), catalogTopologyKey))
        {
            return existing;
        }

        QuerySession newSession = new QuerySession(buildCatalogRegistry(catalogState), Map.of());
        newSession.setGenericCache(GENERIC_CACHE);
        SessionHolder result = new SessionHolder(newSession, String.valueOf(sessionCounter.incrementAndGet()), catalogTopologyKey);
        fileSessionHolder.sessionHolder = result;
        return result;
    }

    private static CatalogTopologyKey catalogTopologyKey(PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        List<CatalogTopologyEntry> entries = state.instancesByAlias()
                .values()
                .stream()
                .map(instance -> new CatalogTopologyEntry(instance.alias(), instance.catalogId()))
                .sorted(Comparator.comparing(CatalogTopologyEntry::alias))
                .toList();
        return new CatalogTopologyKey(entries);
    }

    private void clearExecutionCatalogProperties(QuerySession session, PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state)
    {
        Map<String, PayloadbuilderCatalogProviderContributor> providersByAlias = buildProvidersByAlias(state);
        for (PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState.Instance instance : state.instancesByAlias()
                .values())
        {
            PayloadbuilderCatalogProviderContributor provider = providersByAlias.get(instance.alias());
            if (provider != null)
            {
                provider.clearProperties(session, instance.alias(), instance.properties());
            }
            else
            {
                for (String propertyKey : instance.properties()
                        .keySet())
                {
                    session.setCatalogProperty(instance.alias(), propertyKey, (Object) null);
                }
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
            return sqlSemanticHandler.complete(fileId, payload);
        }
        if ("sql.hover".equals(action))
        {
            return sqlSemanticHandler.hover(fileId, payload);
        }
        if ("sql.symbolAtPosition".equals(action))
        {
            return sqlSemanticHandler.symbolAtPosition(fileId, payload);
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

    private Map<String, ValueVector> injectEnvironmentVariables(QuerySession session, String selectedEnvironmentId)
    {
        Map<String, Object> variables = resolveEnvironmentVariables(selectedEnvironmentId);
        Map<String, ValueVector> normalizedVariables = new HashMap<>(variables.size());
        for (Map.Entry<String, Object> entry : variables.entrySet())
        {
            String rawKey = entry.getKey();
            if (rawKey == null
                    || rawKey.isBlank())
            {
                throw new IllegalArgumentException("Environment variable keys must be non-blank");
            }
            String key = rawKey.toLowerCase(Locale.ROOT);
            ValueVector vector = entry.getValue() == null ? ValueVector.literalNull(ResolvedType.ANY, 1)
                    : ValueVector.literalAny(1, entry.getValue());
            if (normalizedVariables.putIfAbsent(key, vector) != null)
            {
                throw new IllegalArgumentException("Duplicate environment variable key: " + rawKey);
            }
        }

        Map<String, ValueVector> sessionVariables = session.getVariables();
        Map<String, ValueVector> previousValues = new HashMap<>(normalizedVariables.size());
        for (Map.Entry<String, ValueVector> entry : normalizedVariables.entrySet())
        {
            previousValues.put(entry.getKey(), sessionVariables.put(entry.getKey(), entry.getValue()));
        }
        return previousValues;
    }

    private void restoreEnvironmentVariables(QuerySession session, Map<String, ValueVector> previousValues)
    {
        if (session == null)
        {
            return;
        }
        Map<String, ValueVector> sessionVariables = session.getVariables();
        for (Map.Entry<String, ValueVector> entry : previousValues.entrySet())
        {
            if (entry.getValue() == null)
            {
                sessionVariables.remove(entry.getKey());
            }
            else
            {
                sessionVariables.put(entry.getKey(), entry.getValue());
            }
        }
    }

    private List<String> mergeActions()
    {
        List<String> actions = new ArrayList<>();
        actions.add("engine.capabilities");
        actions.add("sql.parse.snapshot");
        actions.add("sql.complete");
        actions.add("sql.hover");
        actions.add("sql.symbolAtPosition");
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
        FileSessionHolder holder = sessionByFileId.remove(session.fileId());
        if (holder != null)
        {
            holder.lock.lock();
            try
            {
                holder.sessionHolder = null;
            }
            finally
            {
                holder.lock.unlock();
            }
        }
    }

    static int publishTupleVectorInChunks(QueryPublisher publisher, TupleVector tupleVector, int chunkSize)
    {
        return publishTupleVectorInChunks(publisher, tupleVector, chunkSize, LargeValueStore.inlineOnly(), "inline");
    }

    static int publishTupleVectorInChunks(QueryPublisher publisher, TupleVector tupleVector, int chunkSize, LargeValueStore largeValueStore, String queryExecutionId)
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
                row.add(rowValueAsSerializableObject(tupleVector.getColumn(columnIndex), rowIndex, largeValueStore, queryExecutionId));
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
        return rowValueAsSerializableObject(valueVector, rowIndex, LargeValueStore.inlineOnly(), "inline");
    }

    private static Object rowValueAsSerializableObject(ValueVector valueVector, int rowIndex, LargeValueStore largeValueStore, String queryExecutionId)
    {
        if (valueVector.isNull(rowIndex))
        {
            return null;
        }

        Column.Type type = valueVector.type()
                .getType();
        if (type == Column.Type.Table)
        {
            return storeJsonCell(largeValueStore, queryExecutionId, writer -> writeTableJson(writer, valueVector.getTable(rowIndex)));
        }
        if (type == Column.Type.Array)
        {
            return storeJsonCell(largeValueStore, queryExecutionId, writer -> writeArrayJson(writer, valueVector.getArray(rowIndex)));
        }
        if (type == Column.Type.Object)
        {
            return storeJsonCell(largeValueStore, queryExecutionId, writer -> writeObjectJson(writer, valueVector.getObject(rowIndex)));
        }
        if (type == Column.Type.String)
        {
            return largeValueStore.storeText(queryExecutionId, LARGE_TYPE_TEXT, CONTENT_TYPE_TEXT, valueVector.getString(rowIndex)
                    .toString());
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
            return anyValueAsSerializableObject(valueVector.getAny(rowIndex), largeValueStore, queryExecutionId);
        }

        return anyValueAsSerializableObject(valueVector.valueAsObject(rowIndex), largeValueStore, queryExecutionId);
    }

    private static Object anyValueAsSerializableObject(Object value, LargeValueStore largeValueStore, String queryExecutionId)
    {
        if (value == null)
        {
            return null;
        }
        if (value instanceof UTF8String s)
        {
            return largeValueStore.storeText(queryExecutionId, LARGE_TYPE_TEXT, CONTENT_TYPE_TEXT, s.toString());
        }
        if (value instanceof String s)
        {
            return largeValueStore.storeText(queryExecutionId, LARGE_TYPE_TEXT, CONTENT_TYPE_TEXT, s);
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

        if (value instanceof TupleVector
                || value instanceof ObjectVector
                || value instanceof ValueVector
                || value instanceof Map<?, ?>
                || value instanceof Iterable<?>)
        {
            return storeJsonCell(largeValueStore, queryExecutionId, writer -> writeAnyJson(writer, value));
        }

        return value;
    }

    private static Object storeJsonCell(LargeValueStore largeValueStore, String queryExecutionId, JsonWriteAction action)
    {
        LargeValueWriter largeValueWriter = null;
        try
        {
            largeValueWriter = largeValueStore.create(queryExecutionId, LARGE_TYPE_JSON, CONTENT_TYPE_JSON);
            action.write(largeValueWriter.writer());
            return largeValueWriter.closeToCell();
        }
        catch (IOException e)
        {
            abortQuietly(largeValueWriter);
            throw new IllegalStateException("Could not encode result cell", e);
        }
    }

    private static void abortQuietly(LargeValueWriter largeValueWriter)
    {
        if (largeValueWriter == null)
        {
            return;
        }
        try
        {
            largeValueWriter.abort();
        }
        catch (IOException e)
        {
            // Preserve the original serialization/write failure.
        }
    }

    private static void writeTableJson(Writer writer, TupleVector table) throws IOException
    {
        if (table == null)
        {
            writer.write("null");
            return;
        }
        writer.write('[');
        for (int rowIndex = 0; rowIndex < table.getRowCount(); rowIndex++)
        {
            if (rowIndex > 0)
            {
                writer.write(',');
            }
            writeTupleRowJson(writer, table, rowIndex);
        }
        writer.write(']');
    }

    private static void writeTupleRowJson(Writer writer, TupleVector table, int rowIndex) throws IOException
    {
        writer.write('{');
        int columnCount = table.getSchema()
                .getSize();
        for (int columnIndex = 0; columnIndex < columnCount; columnIndex++)
        {
            if (columnIndex > 0)
            {
                writer.write(',');
            }
            String name = table.getSchema()
                    .getColumns()
                    .get(columnIndex)
                    .getName();
            writeJsonString(writer, name);
            writer.write(':');
            writeValueVectorCellJson(writer, table.getColumn(columnIndex), rowIndex);
        }
        writer.write('}');
    }

    private static void writeArrayJson(Writer writer, ValueVector arrayVector) throws IOException
    {
        writer.write('[');
        for (int i = 0; i < arrayVector.size(); i++)
        {
            if (i > 0)
            {
                writer.write(',');
            }
            writeValueVectorCellJson(writer, arrayVector, i);
        }
        writer.write(']');
    }

    private static void writeObjectJson(Writer writer, ObjectVector object) throws IOException
    {
        writer.write('{');
        int columnCount = object.getSchema()
                .getSize();
        int rowIndex = object.getRow();
        for (int columnIndex = 0; columnIndex < columnCount; columnIndex++)
        {
            if (columnIndex > 0)
            {
                writer.write(',');
            }
            String name = object.getSchema()
                    .getColumns()
                    .get(columnIndex)
                    .getName();
            writeJsonString(writer, name);
            writer.write(':');
            writeValueVectorCellJson(writer, object.getValue(columnIndex), rowIndex);
        }
        writer.write('}');
    }

    private static void writeValueVectorCellJson(Writer writer, ValueVector valueVector, int rowIndex) throws IOException
    {
        if (valueVector.isNull(rowIndex))
        {
            writer.write("null");
            return;
        }
        Column.Type type = valueVector.type()
                .getType();
        if (type == Column.Type.Table)
        {
            writeTableJson(writer, valueVector.getTable(rowIndex));
        }
        else if (type == Column.Type.Array)
        {
            writeArrayJson(writer, valueVector.getArray(rowIndex));
        }
        else if (type == Column.Type.Object)
        {
            writeObjectJson(writer, valueVector.getObject(rowIndex));
        }
        else if (type == Column.Type.String)
        {
            writeJsonString(writer, valueVector.getString(rowIndex)
                    .toString());
        }
        else if (type == Column.Type.Boolean)
        {
            writer.write(Boolean.toString(valueVector.getBoolean(rowIndex)));
        }
        else if (type == Column.Type.Int)
        {
            writer.write(Integer.toString(valueVector.getInt(rowIndex)));
        }
        else if (type == Column.Type.Long)
        {
            writer.write(Long.toString(valueVector.getLong(rowIndex)));
        }
        else if (type == Column.Type.Decimal)
        {
            writer.write(valueVector.getDecimal(rowIndex)
                    .asBigDecimal()
                    .toPlainString());
        }
        else if (type == Column.Type.Float)
        {
            float value = valueVector.getFloat(rowIndex);
            if (Float.isFinite(value))
            {
                writer.write(Float.toString(value));
            }
            else
            {
                writeJsonString(writer, Float.toString(value));
            }
        }
        else if (type == Column.Type.Double)
        {
            double value = valueVector.getDouble(rowIndex);
            if (Double.isFinite(value))
            {
                writer.write(Double.toString(value));
            }
            else
            {
                writeJsonString(writer, Double.toString(value));
            }
        }
        else if (type == Column.Type.DateTime)
        {
            writeJsonString(writer, valueVector.getDateTime(rowIndex)
                    .getLocalDateTime()
                    .toString());
        }
        else if (type == Column.Type.DateTimeOffset)
        {
            writeJsonString(writer, valueVector.getDateTimeOffset(rowIndex)
                    .getZonedDateTime()
                    .toString());
        }
        else if (type == Column.Type.Any)
        {
            writeAnyJson(writer, valueVector.getAny(rowIndex));
        }
        else
        {
            writeAnyJson(writer, valueVector.valueAsObject(rowIndex));
        }
    }

    private static void writeAnyJson(Writer writer, Object value) throws IOException
    {
        if (value == null)
        {
            writer.write("null");
        }
        else if (value instanceof TupleVector table)
        {
            writeTableJson(writer, table);
        }
        else if (value instanceof ObjectVector object)
        {
            writeObjectJson(writer, object);
        }
        else if (value instanceof UTF8String s)
        {
            writeJsonString(writer, s.toString());
        }
        else if (value instanceof Decimal d)
        {
            writer.write(d.asBigDecimal()
                    .toPlainString());
        }
        else if (value instanceof EpochDateTime d)
        {
            writeJsonString(writer, d.getLocalDateTime()
                    .toString());
        }
        else if (value instanceof EpochDateTimeOffset d)
        {
            writeJsonString(writer, d.getZonedDateTime()
                    .toString());
        }
        else if (value instanceof Map<?, ?> map)
        {
            writer.write('{');
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet())
            {
                if (!first)
                {
                    writer.write(',');
                }
                first = false;
                writeJsonString(writer, String.valueOf(entry.getKey()));
                writer.write(':');
                writeAnyJson(writer, entry.getValue());
            }
            writer.write('}');
        }
        else if (value instanceof Iterable<?> iterable)
        {
            writer.write('[');
            boolean first = true;
            for (Object item : iterable)
            {
                if (!first)
                {
                    writer.write(',');
                }
                first = false;
                writeAnyJson(writer, item);
            }
            writer.write(']');
        }
        else if (value instanceof ValueVector vector)
        {
            writeArrayJson(writer, vector);
        }
        else if (value instanceof Boolean b)
        {
            writer.write(Boolean.toString(b));
        }
        else if (value instanceof Number number)
        {
            writer.write(number.toString());
        }
        else
        {
            writeJsonString(writer, value.toString());
        }
    }

    private static void writeJsonString(Writer writer, String value) throws IOException
    {
        writer.write('"');
        int segmentStart = 0;
        for (int i = 0; i < value.length(); i++)
        {
            char c = value.charAt(i);
            String escape = switch (c)
            {
                case '"' -> "\\\"";
                case '\\' -> "\\\\";
                case '\b' -> "\\b";
                case '\f' -> "\\f";
                case '\n' -> "\\n";
                case '\r' -> "\\r";
                case '\t' -> "\\t";
                default -> c < 0x20 ? String.format("\\u%04x", (int) c)
                        : null;
            };
            if (escape != null)
            {
                if (segmentStart < i)
                {
                    writer.write(value, segmentStart, i - segmentStart);
                }
                writer.write(escape);
                segmentStart = i + 1;
            }
        }
        if (segmentStart < value.length())
        {
            writer.write(value, segmentStart, value.length() - segmentStart);
        }
        writer.write('"');
    }

    @FunctionalInterface
    private interface JsonWriteAction
    {
        void write(Writer writer) throws IOException;
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
        SessionHolder holder = sessionByExecutionId.get(queryExecutionId);
        if (holder != null)
        {
            holder.session.fireAbortQueryListeners();
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

    record CatalogTopologyKey(List<CatalogTopologyEntry> entries)
    {
        CatalogTopologyKey
        {
            entries = List.copyOf(entries);
        }
    }

    record CatalogTopologyEntry(String alias, String catalogId)
    {
    }

    static final class FileSessionHolder
    {
        private final ReentrantLock lock = new ReentrantLock(true);
        private SessionHolder sessionHolder;
    }

    record SessionHolder(QuerySession session, String sessionId, CatalogTopologyKey catalogTopologyKey)
    {
        SessionHolder(QuerySession session, String sessionId)
        {
            this(session, sessionId, new CatalogTopologyKey(List.of()));
        }

        SessionHolder
        {
            requireNonNull(session);
            requireNonNull(sessionId);
            requireNonNull(catalogTopologyKey);
        }
    }
}
