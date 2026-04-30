package com.queryeer.backend.queryengine.jdbc;

import java.util.List;

public interface JdbcQueryEventListener
{
    void onResultSetStart(List<JdbcResultColumn> columns);

    void onRows(List<List<Object>> rows);
}
