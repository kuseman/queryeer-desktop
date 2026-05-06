package com.queryeer.backend.api;

import java.util.List;

/** Callback interface for publishing query execution results back to the transport layer. */
public interface QueryPublisher
{
    void progress(int percent, String message);

    /** Called once per result set to announce its schema before any rows are sent. */
    void resultSetStart(List<String> columnNames, List<String> columnTypes);

    /** Called one or more times after {@link #resultSetStart} to stream row batches. */
    void resultSetRows(List<List<Object>> rows);

    /** Called one or more times after {@link #resultSetStart} to stream row batches with accompanying output messages (info, warnings, errors). */
    default void resultSetRows(List<List<Object>> rows, List<OutputEvent> messages)
    {
        resultSetRows(rows);
    }

    void completed(long durationMs, long rowCount);

    default void completed(long durationMs, long rowCount, Object engineState)
    {
        completed(durationMs, rowCount);
    }

    /** errorCode should match a {@code BackendErrorCode} name, falls back to INTERNAL */
    void failed(String errorCode, String errorMessage);

    /**
     * Failed with additional details (e.g. engineState, line/column info).
     */
    default void failed(String errorCode, String errorMessage, java.util.Map<String, Object> details)
    {
        failed(errorCode, errorMessage);
    }
}
