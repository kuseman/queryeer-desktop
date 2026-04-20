package com.queryeer.backend.transport.stdio;

import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.query.ColumnDefinition;
import com.queryeer.backend.contract.query.QueryCancelParams;
import com.queryeer.backend.contract.query.QueryCompletedNotification;
import com.queryeer.backend.contract.query.QueryExecuteParams;
import com.queryeer.backend.contract.query.QueryFailedNotification;
import com.queryeer.backend.contract.query.QueryMetrics;
import com.queryeer.backend.contract.query.QueryProgressNotification;
import com.queryeer.backend.contract.query.QueryResultChunkNotification;
import com.queryeer.backend.contract.query.ResultSchema;

public final class MockQueryExecutionService
{
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
    private final Set<String> cancelledExecutionIds = ConcurrentHashMap.newKeySet();
    private final NotificationPublisher notificationPublisher;

    public MockQueryExecutionService(NotificationPublisher notificationPublisher)
    {
        this.notificationPublisher = notificationPublisher;
    }

    public void execute(QueryExecuteParams params)
    {
        scheduler.schedule(() ->
        {
            if (cancelledExecutionIds.contains(params.queryExecutionId()))
            {
                return;
            }
            notificationPublisher.publish("query.progress", new QueryProgressNotification(params.queryExecutionId(), 20, "Running " + params.engineId()));
        }, 120, TimeUnit.MILLISECONDS);

        scheduler.schedule(() ->
        {
            if (cancelledExecutionIds.contains(params.queryExecutionId()))
            {
                return;
            }
            notificationPublisher.publish("query.resultChunk", new QueryResultChunkNotification(params.queryExecutionId(), 0,
                    new ResultSchema(List.of(new ColumnDefinition("id", "integer"), new ColumnDefinition("value", "string"))), List.of(List.of(1, "alpha"), List.of(2, "beta")), false));
        }, 280, TimeUnit.MILLISECONDS);

        scheduler.schedule(() ->
        {
            if (cancelledExecutionIds.contains(params.queryExecutionId()))
            {
                return;
            }
            notificationPublisher.publish("query.completed", new QueryCompletedNotification(params.queryExecutionId(), new QueryMetrics(600, 2)));
        }, 460, TimeUnit.MILLISECONDS);
    }

    public void cancel(QueryCancelParams params)
    {
        cancelledExecutionIds.add(params.queryExecutionId());
        notificationPublisher.publish("query.failed", new QueryFailedNotification(params.queryExecutionId(), new BackendError(BackendErrorCode.CANCELLED, "Execution cancelled by client", null)));
    }
}
