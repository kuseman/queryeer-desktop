package com.queryeer.backend.plugin.payloadbuilder;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryPublisher;

import se.kuseman.payloadbuilder.api.OutputWriter;
import se.kuseman.payloadbuilder.core.Payloadbuilder;
import se.kuseman.payloadbuilder.core.QueryResult;
import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

public final class PayloadbuilderQueryEngineProvider implements QueryEngineProvider
{
    private final CatalogRegistry catalogRegistry = new CatalogRegistry();
    private final Set<String> cancelledExecutionIds = ConcurrentHashMap.newKeySet();
    private final Map<String, QuerySession> activeSessions = new ConcurrentHashMap<>();

    @Override
    public String engineId()
    {
        return "payloadbuilder";
    }

    @Override
    public void execute(String queryExecutionId, String text, QueryPublisher publisher)
    {
        QuerySession session = new QuerySession(catalogRegistry);
        session.setAbortSupplier(() -> cancelledExecutionIds.contains(queryExecutionId));
        activeSessions.put(queryExecutionId, session);

        long startMs = System.currentTimeMillis();
        try
        {
            QueryResult result = Payloadbuilder.compile(session, text)
                    .execute(session);

            long rowCount = 0;
            while (result.hasMoreResults())
            {
                ChunkingOutputWriter writer = new ChunkingOutputWriter();
                result.writeResult(writer);
                publisher.resultSetStart(writer.getColumnNames(), writer.getColumnTypes());
                if (!writer.getRows()
                        .isEmpty())
                {
                    publisher.resultSetRows(writer.getRows());
                    rowCount += writer.getRows()
                            .size();
                }
            }

            publisher.completed(System.currentTimeMillis() - startMs, rowCount);
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
            activeSessions.remove(queryExecutionId);
        }
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

    /** Accumulates one result set into column names and rows for a single {@code result.writeResult()} call. */
    static final class ChunkingOutputWriter implements OutputWriter
    {
        private final List<String> columnNames = new ArrayList<>();
        private final List<String> columnTypes = new ArrayList<>();
        private final List<List<Object>> rows = new ArrayList<>();

        private List<Object> currentRow;
        private int nestDepth = 0;
        private StringBuilder nestedBuffer;

        List<String> getColumnNames()
        {
            return columnNames;
        }

        List<String> getColumnTypes()
        {
            return columnTypes;
        }

        List<List<Object>> getRows()
        {
            return rows;
        }

        @Override
        public void initResult(String[] columns)
        {
            if (columns != null)
            {
                for (String col : columns)
                {
                    columnNames.add(col);
                    columnTypes.add("any");
                }
            }
        }

        @Override
        public void startRow()
        {
            currentRow = new ArrayList<>();
        }

        @Override
        public void endRow()
        {
            if (currentRow != null)
            {
                rows.add(currentRow);
                currentRow = null;
            }
        }

        @Override
        public void writeFieldName(String name)
        {
            if (nestDepth == 0
                    && !columnNames.contains(name))
            {
                columnNames.add(name);
                columnTypes.add("any");
            }
        }

        @Override
        public void writeValue(Object value)
        {
            if (nestDepth > 0
                    && nestedBuffer != null)
            {
                if (nestedBuffer.length() > 1)
                {
                    nestedBuffer.append(",");
                }
                nestedBuffer.append(value);
            }
            else if (currentRow != null)
            {
                currentRow.add(value);
            }
        }

        @Override
        public void startObject()
        {
            nestDepth++;
            if (nestDepth == 1)
            {
                nestedBuffer = new StringBuilder("{");
            }
            else
            {
                nestedBuffer.append("{");
            }
        }

        @Override
        public void endObject()
        {
            nestedBuffer.append("}");
            nestDepth--;
            if (nestDepth == 0)
            {
                if (currentRow != null)
                {
                    currentRow.add(nestedBuffer.toString());
                }
                nestedBuffer = null;
            }
        }

        @Override
        public void startArray()
        {
            nestDepth++;
            if (nestedBuffer == null)
            {
                nestedBuffer = new StringBuilder("[");
            }
            else
            {
                nestedBuffer.append("[");
            }
        }

        @Override
        public void endArray()
        {
            nestedBuffer.append("]");
            nestDepth--;
            if (nestDepth == 0)
            {
                if (currentRow != null)
                {
                    currentRow.add(nestedBuffer.toString());
                }
                nestedBuffer = null;
            }
        }
    }
}
