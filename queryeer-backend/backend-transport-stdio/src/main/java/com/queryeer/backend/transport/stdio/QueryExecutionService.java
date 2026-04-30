package com.queryeer.backend.transport.stdio;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.queryeer.backend.api.ErrorMessages;
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

final class QueryExecutionService
{
    private final ExecutorService executor = Executors.newCachedThreadPool();
    private final Map<String, QueryEngineProvider> activeExecutions = new ConcurrentHashMap<>();
    private final QueryEngineRegistry engineRegistry;
    private final NotificationPublisher notificationPublisher;
    private final SecretRefPayloadResolver secretResolver;

    public QueryExecutionService(QueryEngineRegistry engineRegistry, NotificationPublisher notificationPublisher, SecretRefPayloadResolver secretResolver)
    {
        this.engineRegistry = engineRegistry;
        this.notificationPublisher = notificationPublisher;
        this.secretResolver = secretResolver;
    }

    public void execute(QueryExecuteParams params)
    {
        QueryEngineProvider provider = engineRegistry.getProvider(params.engineId());
        if (provider == null)
        {
            notificationPublisher.publishForQuery(params.queryExecutionId(), "queryengine.failed",
                    new QueryFailedNotification(params.queryExecutionId(), new BackendError(BackendErrorCode.ENGINE_NOT_FOUND, "No engine registered for id: " + params.engineId(), null)));
            return;
        }

        QueryPublisher publisher = new TransportQueryPublisher(params.queryExecutionId(), notificationPublisher);
        activeExecutions.put(params.queryExecutionId(), provider);
        executor.submit(() ->
        {
            try
            {
                Object resolvedEngineState = secretResolver.materialize(params.engineState());
                provider.execute(params.queryExecutionId(), params.text(), resolvedEngineState, publisher);
            }
            catch (SecretRefPayloadResolver.SecretResolutionException e)
            {
                publisher.failed(BackendErrorCode.VALIDATION.name(), e.getMessage());
            }
            catch (Exception e)
            {
                publisher.failed("INTERNAL", ErrorMessages.buildFailureMessage(e));
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
            notificationPublisher.publishForQuery(params.queryExecutionId(), "queryengine.failed",
                    new QueryFailedNotification(params.queryExecutionId(), new BackendError(BackendErrorCode.CANCELLED, "Execution cancelled by client", null)));
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
            notificationPublisher.publishForQuery(executionId, "queryengine.progress", new QueryProgressNotification(executionId, percent, message));
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
            notificationPublisher.publishForQuery(executionId, "queryengine.chunkStart", new QueryChunkStartNotification(executionId, currentResultSetIndex, new ResultSchema(columns)));
        }

        @Override
        public void resultSetRows(List<List<Object>> rows)
        {
            notificationPublisher.publishForQuery(executionId, "queryengine.chunkRows", new QueryChunkRowsNotification(executionId, currentResultSetIndex, rows));
        }

        @Override
        public void completed(long durationMs, long rowCount)
        {
            completed(durationMs, rowCount, null);
        }

        @Override
        public void completed(long durationMs, long rowCount, Object engineStatePatch)
        {
            notificationPublisher.publishForQuery(executionId, "queryengine.completed",
                    new QueryCompletedNotification(executionId, new QueryMetrics((int) durationMs, (int) rowCount), engineStatePatch));
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
            notificationPublisher.publishForQuery(executionId, "queryengine.failed", new QueryFailedNotification(executionId, new BackendError(code, errorMessage, null)));
        }
    }
}
