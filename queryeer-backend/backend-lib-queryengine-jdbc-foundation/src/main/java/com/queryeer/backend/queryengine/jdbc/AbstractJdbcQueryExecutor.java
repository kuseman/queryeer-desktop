package com.queryeer.backend.queryengine.jdbc;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLWarning;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Base JDBC query executor implementing the full execute/cancel/streaming lifecycle. Subclasses provide three hooks:
 * <ul>
 * <li>{@link #openConnection} — how to build the JDBC {@link Connection} (required)</li>
 * <li>{@link #splitStatements} — how to split the incoming SQL into individual batches (optional, default: single statement)</li>
 * <li>{@link #mapColumnValue} — how to coerce a raw column value before publishing (optional, default: identity)</li>
 * </ul>
 */
public abstract class AbstractJdbcQueryExecutor implements CancellableJdbcQueryExecutor
{
    protected final int rowChunkSize;
    private final Map<String, Statement> activeStatements = new ConcurrentHashMap<>();

    protected AbstractJdbcQueryExecutor()
    {
        this(100);
    }

    protected AbstractJdbcQueryExecutor(int rowChunkSize)
    {
        this.rowChunkSize = Math.max(1, rowChunkSize);
    }

    /** Opens a JDBC connection for the given connection profile. */
    protected abstract Connection openConnection(JdbcConnectionProfile profile) throws SQLException;

    /**
     * Splits the SQL text into individual statements executed sequentially. Default: a single-element list containing the original SQL string (no splitting).
     */
    protected List<String> splitStatements(String sql)
    {
        return List.of(sql);
    }

    /**
     * Maps a raw column value fetched via {@code ResultSet.getObject()} to the value published to the event listener. Default: return the value unchanged.
     *
     * @param value the raw value from the result set (may be {@code null})
     * @param columnTypeName the JDBC type name in lower case (e.g. {@code "varchar"}, {@code "datetimeoffset"})
     */
    protected Object mapColumnValue(Object value, String columnTypeName)
    {
        return value;
    }

    @Override
    public final JdbcQueryResult execute(JdbcQueryRequest request, JdbcQueryEventListener eventListener)
    {
        long rowCount = 0L;
        List<String> statements = splitStatements(request.sql());
        String resolvedDatabase = null;
        String resolvedSessionId = null;

        try
        {
            Connection sessionConnection = request.sessionConnection();
            if (sessionConnection != null)
            {
                applyDatabaseIfRequested(request, sessionConnection);
                for (String sql : statements)
                {
                    try (Statement statement = sessionConnection.createStatement())
                    {
                        rowCount += runStatement(sql, request.queryExecutionId(), eventListener, statement);
                    }
                }
                forwardWarnings(sessionConnection.getWarnings(), eventListener);
                sessionConnection.clearWarnings();
                resolvedDatabase = resolveCurrentDatabaseIfPossible(request, sessionConnection);
            }
            else
            {
                try (Connection jdbcConnection = openConnection(request.connection()))
                {
                    applyDatabaseIfRequested(request, jdbcConnection);
                    for (String sql : statements)
                    {
                        try (Statement statement = jdbcConnection.createStatement())
                        {
                            rowCount += runStatement(sql, request.queryExecutionId(), eventListener, statement);
                        }
                    }
                    forwardWarnings(jdbcConnection.getWarnings(), eventListener);
                    jdbcConnection.clearWarnings();
                    resolvedDatabase = resolveCurrentDatabaseIfPossible(request, jdbcConnection);
                    resolvedSessionId = resolveSessionIdIfPossible(request, jdbcConnection);
                }
            }
        }
        catch (SQLException e)
        {
            throw new JdbcQueryExecutionException(e.getMessage(), e);
        }
        finally
        {
            activeStatements.remove(request.queryExecutionId());
        }

        java.util.Map<String, Object> engineState = new java.util.LinkedHashMap<>();
        if (resolvedDatabase != null)
        {
            engineState.put("database", resolvedDatabase);
        }
        if (resolvedSessionId != null
                && !resolvedSessionId.isBlank())
        {
            engineState.put("sessionId", resolvedSessionId);
        }
        return new JdbcQueryResult(rowCount, engineState);
    }

    private void forwardWarnings(SQLWarning warning, JdbcQueryEventListener eventListener)
    {
        while (warning != null)
        {
            eventListener.onOutput(warning.getMessage());
            warning = warning.getNextWarning();
        }
    }

    private static void applyDatabaseIfRequested(JdbcQueryRequest request, Connection connection) throws SQLException
    {
        if (request.database() != null
                && !request.database()
                        .isBlank()
                && request.dialect() != null)
        {
            request.dialect()
                    .applyDatabase(connection, request.database());
        }
    }

    private static String resolveCurrentDatabaseIfPossible(JdbcQueryRequest request, Connection connection)
    {
        if (request.dialect() == null)
        {
            return null;
        }
        try
        {
            return request.dialect()
                    .resolveCurrentDatabase(connection);
        }
        catch (SQLException ignored)
        {
            return null;
        }
    }

    private static String resolveSessionIdIfPossible(JdbcQueryRequest request, Connection connection)
    {
        if (request.dialect() == null)
        {
            return null;
        }
        try
        {
            return request.dialect()
                    .resolveSessionId(connection);
        }
        catch (SQLException ignored)
        {
            return null;
        }
    }

    @Override
    public void cancel(String queryExecutionId)
    {
        Statement statement = activeStatements.get(queryExecutionId);
        if (statement == null)
        {
            return;
        }
        try
        {
            statement.cancel();
        }
        catch (SQLException ignored)
        {
        }
    }

    private long runStatement(String sql, String queryExecutionId, JdbcQueryEventListener eventListener, Statement statement) throws SQLException
    {
        activeStatements.put(queryExecutionId, statement);
        long rowCount = 0L;
        boolean hasResultSet = statement.execute(sql);
        try
        {
            while (true)
            {
                if (hasResultSet)
                {
                    try (ResultSet resultSet = statement.getResultSet())
                    {
                        rowCount += publishResultSet(resultSet, eventListener);
                    }
                }
                else
                {
                    int updateCount = statement.getUpdateCount();
                    if (updateCount < 0)
                    {
                        break;
                    }
                    rowCount += Math.max(0, updateCount);
                    eventListener.onOutput(updateCount + " Row(s) affected");
                }

                hasResultSet = statement.getMoreResults();
                if (!hasResultSet
                        && statement.getUpdateCount() < 0)
                {
                    break;
                }
            }
        }
        finally
        {
            forwardWarnings(statement.getWarnings(), eventListener);
            statement.clearWarnings();
        }
        return rowCount;
    }

    private long publishResultSet(ResultSet resultSet, JdbcQueryEventListener eventListener) throws SQLException
    {
        if (resultSet == null)
        {
            return 0L;
        }

        ResultSetMetaData metadata = resultSet.getMetaData();
        int columnCount = metadata.getColumnCount();
        List<JdbcResultColumn> columns = new ArrayList<>(columnCount);
        String[] typeNames = new String[columnCount + 1];
        for (int i = 1; i <= columnCount; i++)
        {
            String typeName = metadata.getColumnTypeName(i);
            typeNames[i] = typeName == null ? "unknown"
                    : typeName.toLowerCase();
            columns.add(new JdbcResultColumn(metadata.getColumnLabel(i), typeNames[i]));
        }
        eventListener.onResultSetStart(columns);

        long rowCount = 0L;
        List<List<Object>> batch = new ArrayList<>(rowChunkSize);
        while (resultSet.next())
        {
            List<Object> row = new ArrayList<>(columnCount);
            for (int i = 1; i <= columnCount; i++)
            {
                row.add(mapColumnValue(resultSet.getObject(i), typeNames[i]));
            }
            batch.add(row);
            if (batch.size() == rowChunkSize)
            {
                eventListener.onRows(batch);
                rowCount += batch.size();
                batch = new ArrayList<>(rowChunkSize);
            }
        }

        if (!batch.isEmpty())
        {
            eventListener.onRows(batch);
            rowCount += batch.size();
        }
        return rowCount;
    }

    public static final class JdbcQueryExecutionException extends RuntimeException
    {
        private static final long serialVersionUID = 1L;

        public JdbcQueryExecutionException(String message, Throwable cause)
        {
            super(message, cause);
        }
    }
}
