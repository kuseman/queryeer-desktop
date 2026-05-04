package com.queryeer.backend.transport.stdio;

import java.util.ArrayList;
import java.util.List;

import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.contract.BackendError;
import com.queryeer.backend.contract.BackendErrorCode;
import com.queryeer.backend.contract.query.ColumnDefinition;
import com.queryeer.backend.contract.query.QueryChunkRowsNotification;
import com.queryeer.backend.contract.query.QueryChunkStartNotification;
import com.queryeer.backend.contract.query.QueryCompletedNotification;
import com.queryeer.backend.contract.query.QueryFailedNotification;
import com.queryeer.backend.contract.query.QueryMetrics;
import com.queryeer.backend.contract.query.QueryProgressNotification;
import com.queryeer.backend.contract.query.ResultSchema;

final class TransportQueryPublisher implements QueryPublisher
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
    public void completed(long durationMs, long rowCount, Object engineState)
    {
        notificationPublisher.publishForQuery(executionId, "queryengine.completed", new QueryCompletedNotification(executionId, new QueryMetrics((int) durationMs, (int) rowCount), engineState));
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
