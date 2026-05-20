package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import com.queryeer.backend.contract.query.QueryExecuteOptions;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryEventListener;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryRequest;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcResultColumn;

class SqlServerQueryExecutorTest
{
    private final SqlServerQueryExecutor executor = new SqlServerQueryExecutor();

    @Test
    void splitStatementsReturnsSingleBatchWhenNoGoPresent()
    {
        List<String> result = executor.splitStatements("SELECT 1");
        Assertions.assertEquals(List.of("SELECT 1"), result);
    }

    @Test
    void splitStatementsOnGoSeparator()
    {
        String sql = "SELECT 1\nGO\nSELECT 2";
        List<String> result = executor.splitStatements(sql);
        Assertions.assertEquals(2, result.size());
        Assertions.assertEquals("SELECT 1", result.get(0));
        Assertions.assertEquals("SELECT 2", result.get(1));
    }

    @Test
    void splitStatementsCaseInsensitiveGo()
    {
        String sql = "SELECT 1\ngo\nSELECT 2";
        List<String> result = executor.splitStatements(sql);
        Assertions.assertEquals(2, result.size());
    }

    @Test
    void splitStatementsGoWithLeadingAndTrailingWhitespace()
    {
        String sql = "SELECT 1\n  GO  \nSELECT 2";
        List<String> result = executor.splitStatements(sql);
        Assertions.assertEquals(2, result.size());
    }

    @Test
    void splitStatementsGoWithRepeatCount()
    {
        String sql = "SELECT 1\nGO 3\nSELECT 2";
        List<String> result = executor.splitStatements(sql);
        Assertions.assertEquals(2, result.size());
        Assertions.assertEquals("SELECT 1", result.get(0));
        Assertions.assertEquals("SELECT 2", result.get(1));
    }

    @Test
    void splitStatementsGoInMiddleOfStringIsNotSeparator()
    {
        String sql = "SELECT 'CARGO' FROM t";
        List<String> result = executor.splitStatements(sql);
        Assertions.assertEquals(List.of("SELECT 'CARGO' FROM t"), result);
    }

    @Test
    void splitStatementsMultipleGoBatchSeparators()
    {
        String sql = "CREATE TABLE t (id INT)\nGO\nINSERT INTO t VALUES (1)\nGO\nSELECT * FROM t";
        List<String> result = executor.splitStatements(sql);
        Assertions.assertEquals(3, result.size());
        Assertions.assertEquals("CREATE TABLE t (id INT)", result.get(0));
        Assertions.assertEquals("INSERT INTO t VALUES (1)", result.get(1));
        Assertions.assertEquals("SELECT * FROM t", result.get(2));
    }

    @Test
    void splitStatementsEmptyBatchesAreDiscarded()
    {
        String sql = "GO\nSELECT 1\nGO";
        List<String> result = executor.splitStatements(sql);
        Assertions.assertEquals(List.of("SELECT 1"), result);
    }

    @Test
    void splitStatementsBlankSqlFallsBackToOriginal()
    {
        String sql = "GO\nGO";
        List<String> result = executor.splitStatements(sql);
        Assertions.assertEquals(List.of(sql), result);
    }

    @Test
    void actualPlanStreamsUserRowsBeforeWholeResultSetIsRead() throws Exception
    {
        Connection connection = Mockito.mock(Connection.class);
        Statement statement = Mockito.mock(Statement.class);
        Statement cleanupStatement = Mockito.mock(Statement.class);
        ResultSet resultSet = Mockito.mock(ResultSet.class);
        ResultSetMetaData metadata = Mockito.mock(ResultSetMetaData.class);
        AtomicInteger rowsRead = new AtomicInteger();
        List<Integer> rowsReadAtPublish = new ArrayList<>();

        Mockito.when(connection.createStatement())
                .thenReturn(statement, cleanupStatement);
        Mockito.when(statement.execute(Mockito.anyString()))
                .thenReturn(false, true);
        Mockito.when(statement.getResultSet())
                .thenReturn(resultSet);
        Mockito.when(statement.getMoreResults())
                .thenReturn(false);
        Mockito.when(statement.getUpdateCount())
                .thenReturn(-1);
        Mockito.when(resultSet.getMetaData())
                .thenReturn(metadata);
        Mockito.when(metadata.getColumnCount())
                .thenReturn(1);
        Mockito.when(metadata.getColumnLabel(1))
                .thenReturn("name");
        Mockito.when(metadata.getColumnTypeName(1))
                .thenReturn("varchar");
        Mockito.when(resultSet.next())
                .thenAnswer(_ -> rowsRead.incrementAndGet() <= 250);
        Mockito.when(resultSet.getObject(1))
                .thenAnswer(_ -> "row-" + rowsRead.get());

        JdbcQueryEventListener listener = new JdbcQueryEventListener()
        {
            @Override
            public void onResultSetStart(List<JdbcResultColumn> columns)
            {
            }

            @Override
            public void onRows(List<List<Object>> rows)
            {
                rowsReadAtPublish.add(rowsRead.get());
            }
        };
        QueryExecuteOptions options = new QueryExecuteOptions(null, null, "plan.actual", null, null);
        JdbcQueryRequest request = new JdbcQueryRequest("query-1", "file-1", "SELECT name FROM sys.objects", "connection-1", null, connection, null, null, options);

        var result = executor.executeWithPlan(request, listener);

        Assertions.assertEquals(250L, result.rowCount());
        Assertions.assertFalse(rowsReadAtPublish.isEmpty());
        Assertions.assertEquals(100, rowsReadAtPublish.getFirst());
    }
}
