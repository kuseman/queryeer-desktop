package com.queryeer.backend.queryengine.sql.parser;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.junit.jupiter.api.Test;

class SqlStatementSplitterTest
{
    @Test
    void nullInputReturnsEmptyList()
    {
        assertEquals(List.of(""), SqlStatementSplitter.split(null));
    }

    @Test
    void blankInputReturnsEmptyList()
    {
        assertEquals(List.of(""), SqlStatementSplitter.split(""));
        assertEquals(List.of("   "), SqlStatementSplitter.split("   "));
    }

    @Test
    void singleStatementWithoutSemicolon()
    {
        assertEquals(List.of("SELECT 1"), SqlStatementSplitter.split("SELECT 1"));
    }

    @Test
    void singleStatementWithTrailingSemicolon()
    {
        assertEquals(List.of("SELECT 1"), SqlStatementSplitter.split("SELECT 1;"));
    }

    @Test
    void twoStatementsSeparatedBySemicolon()
    {
        assertEquals(List.of("SELECT 1", "SELECT 2"), SqlStatementSplitter.split("SELECT 1; SELECT 2"));
    }

    @Test
    void threeStatementsSeparatedBySemicolons()
    {
        assertEquals(List.of("SELECT 1", "SELECT 2", "SELECT 3"), SqlStatementSplitter.split("SELECT 1; SELECT 2; SELECT 3"));
    }

    @Test
    void statementsOnSeparateLines()
    {
        assertEquals(List.of("SELECT 1", "SELECT 2"), SqlStatementSplitter.split("SELECT 1;\nSELECT 2"));
    }

    @Test
    void multipleSemicolonsSkipEmptySegments()
    {
        assertEquals(List.of("SELECT 1", "SELECT 2"), SqlStatementSplitter.split("SELECT 1;;\n;SELECT 2"));
    }

    @Test
    void semicolonInStringLiteralIsNotASplitPoint()
    {
        assertEquals(List.of("SELECT 'hello; world'"), SqlStatementSplitter.split("SELECT 'hello; world'"));
    }

    @Test
    void semicolonInStringFollowedByAnotherStatement()
    {
        assertEquals(List.of("SELECT 'a;b'", "SELECT 2"), SqlStatementSplitter.split("SELECT 'a;b'; SELECT 2"));
    }

    @Test
    void semicolonInLineCommentIsNotASplitPoint()
    {
        assertEquals(List.of("SELECT 1 -- comment; with ;"), SqlStatementSplitter.split("SELECT 1 -- comment; with ;"));
    }

    @Test
    void semicolonInLineCommentThenActualSplit()
    {
        assertEquals(List.of("SELECT 1 -- comment; with ;", "SELECT 2"), SqlStatementSplitter.split("SELECT 1 -- comment; with ;\n; SELECT 2"));
    }

    @Test
    void semicolonInBlockCommentIsNotASplitPoint()
    {
        assertEquals(List.of("SELECT 1 /* block; comment; */"), SqlStatementSplitter.split("SELECT 1 /* block; comment; */"));
    }

    @Test
    void semicolonInBlockCommentThenActualSplit()
    {
        assertEquals(List.of("SELECT 1 /* block; comment; */", "SELECT 2"), SqlStatementSplitter.split("SELECT 1 /* block; comment; */; SELECT 2"));
    }

    @Test
    void semicolonInsideParenthesesIsNotASplitPoint()
    {
        assertEquals(List.of("SELECT * FROM t WHERE a = (SELECT 1; SELECT 2)"), SqlStatementSplitter.split("SELECT * FROM t WHERE a = (SELECT 1; SELECT 2)"));
    }

    @Test
    void splitAfterClosingParenAtDepthZero()
    {
        assertEquals(List.of("SELECT * FROM t WHERE a = (SELECT 1)", "SELECT 2"), SqlStatementSplitter.split("SELECT * FROM t WHERE a = (SELECT 1); SELECT 2"));
    }

    @Test
    void nestedParentheses()
    {
        assertEquals(List.of("SELECT fn((1 + 2) * (3 + 4))", "SELECT 2"), SqlStatementSplitter.split("SELECT fn((1 + 2) * (3 + 4)); SELECT 2"));
    }

    @Test
    void quotedIdentifierWithSemicolon()
    {
        assertEquals(List.of("SELECT \"hello;world\""), SqlStatementSplitter.split("SELECT \"hello;world\""));
    }

    @Test
    void fullScriptMultipleStatements()
    {
        String sql = """
                CREATE TABLE t1 (id INT);
                INSERT INTO t1 VALUES (1);
                SELECT * FROM t1;
                """;
        assertEquals(List.of("CREATE TABLE t1 (id INT)", "INSERT INTO t1 VALUES (1)", "SELECT * FROM t1"), SqlStatementSplitter.split(sql));
    }

    @Test
    void whitespaceOnlyBetweenStatements()
    {
        assertEquals(List.of("SELECT 1", "SELECT 2"), SqlStatementSplitter.split(" SELECT 1 ;\n SELECT 2 "));
    }
}
