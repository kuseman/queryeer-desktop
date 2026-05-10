package com.queryeer.backend.queryengine.jdbc.execute;

import java.util.List;

public interface JdbcQueryEventListener
{
    void onResultSetStart(List<JdbcResultColumn> columns);

    void onRows(List<List<Object>> rows);

    /** Called for output messages (e.g. SQLWarnings) during query execution. */
    default void onOutput(String message)
    {
    }
}
