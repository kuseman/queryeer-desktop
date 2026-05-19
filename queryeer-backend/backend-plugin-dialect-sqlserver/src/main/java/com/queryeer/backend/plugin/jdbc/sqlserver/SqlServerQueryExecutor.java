package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLWarning;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import com.queryeer.backend.contract.query.QueryOutputArtifact;
import com.queryeer.backend.queryengine.jdbc.execute.AbstractJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryEventListener;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryPlanExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryRequest;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryResult;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcResultColumn;

final class SqlServerQueryExecutor extends AbstractJdbcQueryExecutor implements JdbcQueryPlanExecutor
{
    /**
     * Matches a T-SQL GO batch separator line: optional whitespace, the word GO (case-insensitive), an optional repeat count, optional trailing whitespace. Must occupy its own line.
     */
    private static final Pattern GO_PATTERN = Pattern.compile("^\\s*GO(?:\\s+\\d+)?\\s*$", Pattern.CASE_INSENSITIVE | Pattern.MULTILINE);

    /**
     * Splits T-SQL on the GO batch separator. GO must appear alone on a line (with optional whitespace). Blank batches (e.g. consecutive GOs) are discarded. Falls back to a single-element list if
     * splitting yields no non-empty batches.
     */
    @Override
    protected List<String> splitStatements(String sql)
    {
        String[] parts = GO_PATTERN.split(sql);
        List<String> batches = new ArrayList<>(parts.length);
        for (String part : parts)
        {
            String trimmed = part.strip();
            if (!trimmed.isEmpty())
            {
                batches.add(trimmed);
            }
        }
        return batches.isEmpty() ? List.of(sql)
                : batches;
    }

    @Override
    protected Object mapColumnValue(Object value, String columnTypeName)
    {
        if (value != null
                && "microsoft.sql.DateTimeOffset".equals(value.getClass()
                        .getName()))
        {
            return value.toString();
        }
        return value;
    }

    @Override
    public JdbcQueryResult executeWithPlan(JdbcQueryRequest request, JdbcQueryEventListener eventListener)
    {
        String intent = request.options() == null ? "plan.actual"
                : request.options()
                        .intent();
        boolean estimated = "plan.estimated".equals(intent);
        boolean includeRawXml = request.options() != null
                && request.options()
                        .dialectOptions() != null
                && "include".equals(String.valueOf(request.options()
                        .dialectOptions()
                        .get("sqlserverPlanXmlOutput")));
        List<String> planXmlDocuments = new ArrayList<>();
        long rowCount = 0L;
        try
        {
            Connection connection = request.sessionConnection();
            boolean closeConnection = false;
            if (connection == null)
            {
                connection = request.dialect()
                        .openSessionConnection(request.connectionProperties());
                closeConnection = true;
            }
            try
            {
                if (request.database() != null
                        && !request.database()
                                .isBlank())
                {
                    request.dialect()
                            .applyDatabase(connection, request.database());
                }
                try (Statement statement = connection.createStatement())
                {
                    statement.execute(estimated ? "SET SHOWPLAN_XML ON"
                            : "SET STATISTICS XML ON");
                    for (String sql : splitStatements(request.sql()))
                    {
                        rowCount += runPlanStatement(statement, request.queryExecutionId(), sql, eventListener, planXmlDocuments, includeRawXml);
                    }
                }
                finally
                {
                    try (Statement cleanup = connection.createStatement())
                    {
                        cleanup.execute(estimated ? "SET SHOWPLAN_XML OFF"
                                : "SET STATISTICS XML OFF");
                    }
                }
                forwardWarnings(connection.getWarnings(), eventListener);
                connection.clearWarnings();
            }
            finally
            {
                if (closeConnection)
                {
                    connection.close();
                }
            }
        }
        catch (SQLException e)
        {
            throw new AbstractJdbcQueryExecutor.JdbcQueryExecutionException(e.getMessage(), e);
        }

        List<QueryOutputArtifact> artifacts = new ArrayList<>();
        int index = 0;
        for (String xml : planXmlDocuments)
        {
            index += 1;
            artifacts.add(new QueryOutputArtifact("sqlserver-plan-" + index, "plan", "graph", estimated ? "Estimated Query Plan"
                    : "Actual Query Plan", SqlServerShowPlanGraphConverter.convert(xml, "sqlserver-plan-" + index)));
        }
        return new JdbcQueryResult(rowCount, Map.of(), artifacts.isEmpty() ? List.of("rows")
                : List.of("rows", "plan"), artifacts);
    }

    private long runPlanStatement(Statement statement, String queryExecutionId, String sql, JdbcQueryEventListener eventListener, List<String> planXmlDocuments, boolean includeRawXml)
            throws SQLException
    {
        registerActiveStatement(queryExecutionId, statement);
        long rowCount = 0L;
        try
        {
            boolean hasResultSet = statement.execute(sql);
            while (true)
            {
                if (hasResultSet)
                {
                    try (ResultSet resultSet = statement.getResultSet())
                    {
                        ResultSetRows rows = readResultSet(resultSet);
                        boolean planXml = rows.rows.stream()
                                .flatMap(List::stream)
                                .filter(String.class::isInstance)
                                .map(String.class::cast)
                                .anyMatch(SqlServerShowPlanGraphConverter::isShowPlanXml);
                        if (planXml)
                        {
                            rows.rows.stream()
                                    .flatMap(List::stream)
                                    .filter(String.class::isInstance)
                                    .map(String.class::cast)
                                    .filter(SqlServerShowPlanGraphConverter::isShowPlanXml)
                                    .forEach(planXmlDocuments::add);
                            if (includeRawXml)
                            {
                                eventListener.onResultSetStart(rows.columns);
                                eventListener.onRows(rows.rows);
                            }
                        }
                        else
                        {
                            eventListener.onResultSetStart(rows.columns);
                            eventListener.onRows(rows.rows);
                            rowCount += rows.rows.size();
                        }
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
        }
        finally
        {
            try
            {
                forwardWarnings(statement.getWarnings(), eventListener);
                statement.clearWarnings();
            }
            finally
            {
                unregisterActiveStatement(queryExecutionId, statement);
            }
        }
        return rowCount;
    }

    private ResultSetRows readResultSet(ResultSet resultSet) throws SQLException
    {
        ResultSetMetaData metadata = resultSet.getMetaData();
        int columnCount = metadata.getColumnCount();
        List<JdbcResultColumn> columns = new ArrayList<>(columnCount);
        for (int i = 1; i <= columnCount; i++)
        {
            columns.add(new JdbcResultColumn(metadata.getColumnLabel(i), metadata.getColumnTypeName(i)));
        }
        List<List<Object>> rows = new ArrayList<>();
        while (resultSet.next())
        {
            List<Object> row = new ArrayList<>(columnCount);
            for (int i = 1; i <= columnCount; i++)
            {
                row.add(resultSet.getObject(i));
            }
            rows.add(row);
        }
        return new ResultSetRows(columns, rows);
    }

    private void forwardWarnings(SQLWarning warning, JdbcQueryEventListener eventListener)
    {
        while (warning != null)
        {
            eventListener.onOutput(warning.getMessage());
            warning = warning.getNextWarning();
        }
    }

    private record ResultSetRows(List<JdbcResultColumn> columns, List<List<Object>> rows)
    {
    }

}
