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

    void completed(long durationMs, long rowCount);

    default void completed(long durationMs, long rowCount, Object engineStatePatch)
    {
        completed(durationMs, rowCount);
    }

    /** errorCode should match a {@code BackendErrorCode} name, falls back to INTERNAL */
    void failed(String errorCode, String errorMessage);
}
