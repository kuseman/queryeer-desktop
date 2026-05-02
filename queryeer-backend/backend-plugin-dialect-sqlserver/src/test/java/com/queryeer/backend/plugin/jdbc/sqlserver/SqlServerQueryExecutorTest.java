package com.queryeer.backend.plugin.jdbc.sqlserver;

import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

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
}
