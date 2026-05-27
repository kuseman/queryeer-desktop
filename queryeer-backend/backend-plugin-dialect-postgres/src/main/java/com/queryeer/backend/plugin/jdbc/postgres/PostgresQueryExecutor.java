package com.queryeer.backend.plugin.jdbc.postgres;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.SQLWarning;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.contract.query.QueryOutputArtifact;
import com.queryeer.backend.queryengine.jdbc.execute.AbstractJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryEventListener;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryPlanExecutor;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryRequest;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryResult;
import com.queryeer.backend.queryengine.sql.parser.SqlStatementSplitter;

final class PostgresQueryExecutor extends AbstractJdbcQueryExecutor implements JdbcQueryPlanExecutor
{
    @Override
    protected List<String> splitStatements(String sql)
    {
        return SqlStatementSplitter.split(sql);
    }

    @Override
    public JdbcQueryResult executeWithPlan(JdbcQueryRequest request, JdbcQueryEventListener eventListener)
    {
        String intent = request.options() == null ? "plan.estimated"
                : request.options()
                        .intent();
        boolean estimated = "plan.estimated".equals(intent);
        boolean analyze = !estimated;

        List<String> planJsonDocuments = new ArrayList<>();
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
                    for (String sql : splitStatements(request.sql()))
                    {
                        String trimmed = sql.strip();
                        if (trimmed.isEmpty())
                        {
                            continue;
                        }
                        String explainSql = (analyze ? "EXPLAIN (FORMAT JSON, ANALYZE) "
                                : "EXPLAIN (FORMAT JSON) ") + trimmed;
                        runPlanStatement(statement, request.queryExecutionId(), explainSql, planJsonDocuments);
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
            throw new JdbcQueryExecutionException(e.getMessage(), e);
        }

        List<QueryOutputArtifact> artifacts = new ArrayList<>();
        int index = 0;
        for (String json : planJsonDocuments)
        {
            index += 1;
            artifacts.add(new QueryOutputArtifact("postgres-plan-" + index, "plan", "graph", estimated ? "Estimated Query Plan"
                    : "Actual Query Plan", PostgresExplainJsonConverter.convert(json, "postgres-plan-" + index)));
        }
        return new JdbcQueryResult(0L, Map.of(), artifacts.isEmpty() ? List.of("rows")
                : List.of("plan"), artifacts);
    }

    private void runPlanStatement(Statement statement, String queryExecutionId, String sql, List<String> planJsonDocuments) throws SQLException
    {
        registerActiveStatement(queryExecutionId, statement);
        try
        {
            boolean hasResultSet = statement.execute(sql);
            while (true)
            {
                if (hasResultSet)
                {
                    try (ResultSet resultSet = statement.getResultSet())
                    {
                        if (resultSet.next())
                        {
                            String value = resultSet.getString(1);
                            if (value != null
                                    && !value.isBlank())
                            {
                                planJsonDocuments.add(value);
                            }
                        }
                    }
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
                statement.clearWarnings();
            }
            finally
            {
                unregisterActiveStatement(queryExecutionId, statement);
            }
        }
    }

    private void forwardWarnings(SQLWarning warning, JdbcQueryEventListener eventListener)
    {
        while (warning != null)
        {
            eventListener.onOutput(warning.getMessage());
            warning = warning.getNextWarning();
        }
    }
}
