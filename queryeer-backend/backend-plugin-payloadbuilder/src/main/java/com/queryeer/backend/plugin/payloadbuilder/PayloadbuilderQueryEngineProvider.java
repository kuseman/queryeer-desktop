package com.queryeer.backend.plugin.payloadbuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryPublisher;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.catalog.Schema;
import se.kuseman.payloadbuilder.api.execution.TupleVector;
import se.kuseman.payloadbuilder.core.Payloadbuilder;
import se.kuseman.payloadbuilder.core.RawQueryResult;
import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

public final class PayloadbuilderQueryEngineProvider implements QueryEngineProvider
{
    static final int ROW_CHUNK_SIZE = 100;

    private final Set<String> cancelledExecutionIds = ConcurrentHashMap.newKeySet();
    private final Map<String, QuerySession> activeSessions = new ConcurrentHashMap<>();
    private final PayloadbuilderCatalogProviderRegistry catalogProviders = PayloadbuilderCatalogProviderRegistry.defaults();

    @Override
    public String engineId()
    {
        return "payloadbuilder";
    }

    @Override
    public void execute(String queryExecutionId, String text, Object engineState, QueryPublisher publisher)
    {
        long startMs = System.currentTimeMillis();
        QuerySession session = null;
        try
        {
            PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState catalogState = PayloadbuilderEngineStateSupport.parse(engineState);
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
                publisher.failed("INTERNAL", e.getMessage() != null ? e.getMessage()
                        : e.getClass()
                                .getSimpleName());
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
                row.add(tupleVector.getColumn(columnIndex)
                        .valueAsObject(rowIndex));
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

    private static List<String> toColumnNames(Schema schema)
    {
        List<String> names = new ArrayList<>(schema.getSize());
        for (int i = 0; i < schema.getSize(); i++)
        {
            names.add(schema.getColumns()
                    .get(i)
                    .getName());
        }
        return names;
    }

    private static List<String> toColumnTypes(Schema schema)
    {
        List<String> types = new ArrayList<>(schema.getSize());
        for (int i = 0; i < schema.getSize(); i++)
        {
            types.add(schema.getColumns()
                    .get(i)
                    .getType()
                    .toTypeString());
        }
        return types;
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
