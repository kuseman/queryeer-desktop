package com.queryeer.backend.plugin.jdbc.postgres;

import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

class PostgresQueryExecutorTest
{
    private final PostgresQueryExecutor executor = new PostgresQueryExecutor();

    @Test
    void splitStatementsReturnsSingleBatchForSimpleQuery()
    {
        List<String> result = executor.splitStatements("SELECT 1");
        Assertions.assertEquals(List.of("SELECT 1"), result);
    }

    @Test
    void splitStatementsReturnsSingleBatchForMultiLineQuery()
    {
        String sql = "SELECT *\nFROM pg_catalog.pg_tables\nWHERE schemaname NOT IN ('pg_catalog', 'information_schema')";
        List<String> result = executor.splitStatements(sql);
        Assertions.assertEquals(List.of(sql), result);
    }

    @Test
    void splitStatementsHandlesEmptyString()
    {
        List<String> result = executor.splitStatements("");
        Assertions.assertEquals(List.of(""), result);
    }

    @Test
    void splitStatementsHandlesNullLikeContent()
    {
        List<String> result = executor.splitStatements("SELECT 'hello; world'");
        Assertions.assertEquals(List.of("SELECT 'hello; world'"), result);
    }

    @Test
    void splitStatementsSplitsOnSemicolons()
    {
        List<String> result = executor.splitStatements("SELECT 1; SELECT 2");
        Assertions.assertEquals(List.of("SELECT 1", "SELECT 2"), result);
    }

    @Test
    void splitStatementsSplitsOnMultipleSemicolons()
    {
        List<String> result = executor.splitStatements("SELECT 1; SELECT 2; SELECT 3");
        Assertions.assertEquals(List.of("SELECT 1", "SELECT 2", "SELECT 3"), result);
    }

    @Test
    void splitStatementsHandlesTrailingSemicolon()
    {
        List<String> result = executor.splitStatements("SELECT 1; SELECT 2;");
        Assertions.assertEquals(List.of("SELECT 1", "SELECT 2"), result);
    }

    @Test
    void splitStatementsHandlesSemicolonsInStrings()
    {
        List<String> result = executor.splitStatements("SELECT 'a;b'; SELECT 2");
        Assertions.assertEquals(List.of("SELECT 'a;b'", "SELECT 2"), result);
    }

    @Test
    void splitStatementsHandlesSemicolonsInComments()
    {
        List<String> result = executor.splitStatements("SELECT 1 -- comment; with semicolon\n; SELECT 2");
        Assertions.assertEquals(List.of("SELECT 1 -- comment; with semicolon", "SELECT 2"), result);
    }

    @Test
    void splitStatementsHandlesSemicolonsInFunction()
    {
        List<String> result = executor.splitStatements("SELECT * FROM t WHERE a = (SELECT 1; SELECT 2)");
        Assertions.assertEquals(List.of("SELECT * FROM t WHERE a = (SELECT 1; SELECT 2)"), result);
    }
}
