package com.queryeer.backend.transport.stdio;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryEngineRegistry;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.query.ColumnDefinition;
import com.queryeer.backend.contract.query.QueryCancelParams;
import com.queryeer.backend.contract.query.QueryChunkRowsNotification;
import com.queryeer.backend.contract.query.QueryChunkStartNotification;
import com.queryeer.backend.contract.query.QueryCompletedNotification;
import com.queryeer.backend.contract.query.QueryExecuteParams;
import com.queryeer.backend.contract.query.QueryFailedNotification;
import com.queryeer.backend.contract.query.QueryMetrics;
import com.queryeer.backend.contract.query.QueryProgressNotification;
import com.queryeer.backend.contract.query.ResultSchema;

public final class QueryExecutionService
{
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, QueryEngineProvider> activeExecutions = new ConcurrentHashMap<>();
    private final QueryEngineRegistry engineRegistry;
    private final NotificationPublisher notificationPublisher;

    public QueryExecutionService(QueryEngineRegistry engineRegistry, NotificationPublisher notificationPublisher)
    {
        this.engineRegistry = engineRegistry;
        this.notificationPublisher = notificationPublisher;
    }

    public void execute(QueryExecuteParams params)
    {
        QueryEngineProvider provider = engineRegistry.getProvider(params.engineId());
        if (provider == null)
        {
            notificationPublisher.publish("query.failed",
                    new QueryFailedNotification(params.queryExecutionId(), new BackendError(BackendErrorCode.ENGINE_NOT_FOUND, "No engine registered for id: " + params.engineId(), null)));
            return;
        }

        QueryPublisher publisher = new TransportQueryPublisher(params.queryExecutionId(), notificationPublisher);
        activeExecutions.put(params.queryExecutionId(), provider);
        executor.submit(() ->
        {
            try
            {
                provider.execute(params.queryExecutionId(), params.text(), publisher);
            }
            catch (Exception e)
            {
                publisher.failed("INTERNAL", e.getMessage() != null ? e.getMessage()
                        : e.getClass()
                                .getSimpleName());
            }
            finally
            {
                activeExecutions.remove(params.queryExecutionId());
            }
        });
    }

    public void cancel(QueryCancelParams params)
    {
        QueryEngineProvider provider = activeExecutions.get(params.queryExecutionId());
        if (provider != null)
        {
            provider.cancel(params.queryExecutionId());
        }
        else
        {
            notificationPublisher.publish("query.failed", new QueryFailedNotification(params.queryExecutionId(), new BackendError(BackendErrorCode.CANCELLED, "Execution cancelled by client", null)));
        }
    }

    private static final class TransportQueryPublisher implements QueryPublisher
    {
        private final String executionId;
        private final NotificationPublisher notificationPublisher;
        private int nextResultSetIndex = 0;
        private int currentResultSetIndex = 0;

        TransportQueryPublisher(String executionId, NotificationPublisher notificationPublisher)
        {
            this.executionId = executionId;
            this.notificationPublisher = notificationPublisher;
        }

        @Override
        public void progress(int percent, String message)
        {
            notificationPublisher.publish("query.progress", new QueryProgressNotification(executionId, percent, message));
        }

        @Override
        public void resultSetStart(List<String> columnNames, List<String> columnTypes)
        {
            currentResultSetIndex = nextResultSetIndex++;
            List<ColumnDefinition> columns = new ArrayList<>();
            for (int i = 0; i < columnNames.size(); i++)
            {
                columns.add(new ColumnDefinition(columnNames.get(i), i < columnTypes.size() ? columnTypes.get(i)
                        : "any"));
            }
            notificationPublisher.publish("query.chunkStart", new QueryChunkStartNotification(executionId, currentResultSetIndex, new ResultSchema(columns)));
        }

        @Override
        public void resultSetRows(List<List<Object>> rows)
        {
            notificationPublisher.publish("query.chunkRows", new QueryChunkRowsNotification(executionId, currentResultSetIndex, rows));
        }

        @Override
        public void completed(long durationMs, long rowCount)
        {
            notificationPublisher.publish("query.completed", new QueryCompletedNotification(executionId, new QueryMetrics((int) durationMs, (int) rowCount)));
        }

        @Override
        public void failed(String errorCode, String errorMessage)
        {
            BackendErrorCode code;
            try
            {
                code = BackendErrorCode.valueOf(errorCode);
            }
            catch (IllegalArgumentException e)
            {
                code = BackendErrorCode.INTERNAL;
            }
            notificationPublisher.publish("query.failed", new QueryFailedNotification(executionId, new BackendError(code, errorMessage, null)));
        }
    }
}
