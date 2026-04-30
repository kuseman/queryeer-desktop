package com.queryeer.backend.queryengine.jdbc;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.ConcurrentHashMap;

public final class DriverManagerJdbcQueryExecutor implements CancellableJdbcQueryExecutor
{
    private final int rowChunkSize;
    private final Map<String, Statement> activeStatements = new ConcurrentHashMap<>();

    public DriverManagerJdbcQueryExecutor()
    {
        this(100);
    }

    public DriverManagerJdbcQueryExecutor(int rowChunkSize)
    {
        this.rowChunkSize = Math.max(1, rowChunkSize);
    }

    @Override
    public JdbcQueryResult execute(JdbcQueryRequest request, JdbcQueryEventListener eventListener)
    {
        long rowCount = 0L;
        JdbcConnectionProfile connectionProfile = request.connection();
        String url = text(connectionProfile.properties()
                .get("url"));
        if (url == null)
        {
            throw new IllegalArgumentException("JDBC connection url is required");
        }

        try
        {
            Connection sessionConnection = request.sessionConnection();
            if (sessionConnection != null)
            {
                try (Statement statement = sessionConnection.createStatement())
                {
                    rowCount += executeStatement(request, eventListener, statement);
                }
            }
            else
            {
                try (Connection jdbcConnection = openConnection(connectionProfile); Statement statement = jdbcConnection.createStatement())
                {
                    rowCount += executeStatement(request, eventListener, statement);
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

        return new JdbcQueryResult(rowCount, Map.of());
    }

    private long executeStatement(JdbcQueryRequest request, JdbcQueryEventListener eventListener, Statement statement) throws SQLException
    {
        activeStatements.put(request.queryExecutionId(), statement);
        long rowCount = 0L;
        boolean hasResultSet = statement.execute(request.sql());
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
            }

            hasResultSet = statement.getMoreResults();
            if (!hasResultSet
                    && statement.getUpdateCount() < 0)
            {
                break;
            }
        }
        return rowCount;
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

    private Connection openConnection(JdbcConnectionProfile connection) throws SQLException
    {
        Properties properties = new Properties();
        String username = text(connection.properties()
                .get("username"));
        String password = text(connection.properties()
                .get("password"));
        if (username != null)
        {
            properties.setProperty("user", username);
        }
        if (password != null)
        {
            properties.setProperty("password", password);
        }
        return DriverManager.getConnection(text(connection.properties()
                .get("url")), properties);
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
        for (int i = 1; i <= columnCount; i++)
        {
            String typeName = metadata.getColumnTypeName(i);
            columns.add(new JdbcResultColumn(metadata.getColumnLabel(i), typeName == null ? "unknown"
                    : typeName.toLowerCase()));
        }
        eventListener.onResultSetStart(columns);

        long rowCount = 0L;
        List<List<Object>> batch = new ArrayList<>(rowChunkSize);
        while (resultSet.next())
        {
            List<Object> row = new ArrayList<>(columnCount);
            for (int i = 1; i <= columnCount; i++)
            {
                row.add(resultSet.getObject(i));
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

    private static String text(Object value)
    {
        if (value instanceof String stringValue)
        {
            String trimmed = stringValue.trim();
            return trimmed.isBlank() ? null
                    : trimmed;
        }
        return null;
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
