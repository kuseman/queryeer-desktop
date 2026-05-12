package com.queryeer.backend.queryengine.sql.parser;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.treesitter.TSParser;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterSql;

class SqlContextDetectorTest
{
    private final TSParser parser = new TSParser();

    {
        parser.setLanguage(new TreeSitterSql());
    }

    @Test
    void detectsFromClause()
    {
        // SELECT * FROM t1
        // from node: (0,9)-(0,16), cursor at pos 14 (on 't' of t1)
        assertContext("SELECT * FROM t1", 1, 15, SqlCompletionContext.TABLE_REFERENCE);
    }

    @Test
    void detectsJoinClause()
    {
        // SELECT * FROM t1 JOIN t2 ON 1 = 1
        // join node: (0,17)-(0,31), cursor at pos 22 (on 't' of t2)
        assertContext("SELECT * FROM t1 JOIN t2 ON 1 = 1", 1, 23, SqlCompletionContext.TABLE_REFERENCE);
    }

    @Test
    void detectsRelationInFromClause()
    {
        // SELECT * FROM dbo.t1
        // from node: (0,9)-(0,20), cursor at pos 18 (on 't' of t1)
        assertContext("SELECT * FROM dbo.t1", 1, 19, SqlCompletionContext.TABLE_REFERENCE);
    }

    @Test
    void detectsSubqueryFromClause()
    {
        // SELECT * FROM (SELECT * FROM t1)
        // inner from: (0,24)-(0,31), cursor at pos 29 (on 't' of inner t1)
        assertContext("SELECT * FROM (SELECT * FROM t1)", 1, 30, SqlCompletionContext.TABLE_REFERENCE);
    }

    @Test
    void returnsOtherForSelectClause()
    {
        // SELECT * FROM t1
        // select node: (0,0)-(0,8), cursor at pos 7 (on '*')
        assertContext("SELECT * FROM t1", 1, 8, SqlCompletionContext.OTHER);
    }

    @Test
    void returnsOtherForWhereClause()
    {
        // SELECT * FROM t1 WHERE x = 1
        // where node: (0,17)-(0,28), cursor at pos 23 (on 'x' in WHERE field)
        assertContext("SELECT * FROM t1 WHERE x = 1", 1, 24, SqlCompletionContext.OTHER);
    }

    @Test
    void returnsOtherForEmptyText()
    {
        TSTree tree = parser.parseString(null, "");
        assertEquals(SqlCompletionContext.OTHER, SqlContextDetector.detectContext(tree, 1, 1));
    }

    @Test
    void returnsOtherForOnCondition()
    {
        // SELECT * FROM t1 JOIN t2 ON t1.x = t2.y
        // binary_expression: (0,28)-(0,39), cursor at pos 28 (on first 't' of t1.x)
        assertContext("SELECT * FROM t1 JOIN t2 ON t1.x = t2.y", 1, 29, SqlCompletionContext.OTHER);
    }

    @Test
    void detectsIncompleteFromOnNextLine()
    {
        assertContext("SELECT *\nFROM ", 2, 6, SqlCompletionContext.TABLE_REFERENCE);
    }

    @Test
    void detectsIncompleteFromOnSameLine()
    {
        assertContext("SELECT * FROM ", 1, 15, SqlCompletionContext.TABLE_REFERENCE);
    }

    @Test
    void detectsIncompleteJoin()
    {
        assertContext("SELECT * FROM t1 JOIN ", 1, 23, SqlCompletionContext.TABLE_REFERENCE);
    }

    @Test
    void returnsOtherForSelectOnly()
    {
        assertContext("SELECT *", 1, 9, SqlCompletionContext.OTHER);
    }

    @Test
    void detectsFromAfterWhereOnPreviousLine()
    {
        // A preceding WHERE clause with binary_expression should NOT bleed into a
        // subsequent FROM on a later line (binary_expression can span multiple lines
        // but exclude check is end-exclusive).
        assertContext("SELECT * FROM t1 WHERE x = 1\nSELECT *\nFROM ", 3, 5, SqlCompletionContext.TABLE_REFERENCE);
    }

    @Test
    void detectsFromAfterCompleteJoinOnPreviousLine()
    {
        assertContext("SELECT * FROM t1 JOIN t2 ON 1 = 1\nSELECT *\nFROM ", 3, 5, SqlCompletionContext.TABLE_REFERENCE);
    }

    @Test
    void respectsWhereOnSameStatement()
    {
        assertContext("SELECT * FROM t1 WHERE x = 1", 1, 24, SqlCompletionContext.OTHER);
    }

    @Test
    void respectsOnClauseInJoin()
    {
        // Cursor inside JOIN's ON condition should not suggest tables
        assertContext("SELECT * FROM t1 JOIN t2 ON t1.x = t2.y", 1, 33, SqlCompletionContext.OTHER);
    }

    @Test
    void returnsOtherForOnAfterJoinWithAlias()
    {
        // Cursor after ON on a multi-line JOIN should not suggest tables
        assertContext("SELECT *\nFROM dbo.tableA f\nINNER JOIN dbo.tableB p\n    ON ", 4, 7, SqlCompletionContext.OTHER);
    }

    @Test
    void returnsOtherForWhereAfterFromWithRelation()
    {
        // Cursor after WHERE with a preceding FROM that has a table should be OTHER
        assertContext("SELECT *\nFROM dbo.tableA\nWHERE ", 3, 6, SqlCompletionContext.OTHER);
    }

    private void assertContext(String sql, int line, int column, SqlCompletionContext expected)
    {
        TSTree tree = parser.parseString(null, sql);
        SqlCompletionContext result = SqlContextDetector.detectContext(tree, line, column);
        assertEquals(expected, result, "Expected " + expected + " for cursor at (" + line + "," + column + ") in: " + sql);
    }
}
