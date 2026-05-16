package com.queryeer.backend.queryengine.sql.parser;

import static com.queryeer.backend.queryengine.sql.parser.SqlParseContext.COLUMN_REFERENCE;
import static com.queryeer.backend.queryengine.sql.parser.SqlParseContext.OTHER;
import static com.queryeer.backend.queryengine.sql.parser.SqlParseContext.TABLE_REFERENCE;
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
        assertContext("SELECT * FROM t1", 1, 15, TABLE_REFERENCE);
    }

    @Test
    void detectsJoinClause()
    {
        assertContext("SELECT * FROM t1 JOIN t2 ON 1 = 1", 1, 23, TABLE_REFERENCE);
    }

    @Test
    void detectsRelationInFromClause()
    {
        assertContext("SELECT * FROM dbo.t1", 1, 19, TABLE_REFERENCE);
    }

    @Test
    void detectsSubqueryFromClause()
    {
        assertContext("SELECT * FROM (SELECT * FROM t1)", 1, 30, TABLE_REFERENCE);
    }

    // -- COLUMN_REFERENCE tests --

    @Test
    void columnReferenceInSelectExpression()
    {
        assertContext("SELECT name FROM t1", 1, 10, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInEmptySelectListBeforeFrom()
    {
        assertContext("SELECT \nFROM public.orders o", 1, 8, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInNonEmptySelectListBeforeFrom()
    {
        assertContext("SELECT na\nFROM public.orders o", 1, 10, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInQualifiedSelectListBeforeFrom()
    {
        assertContext("SELECT o.\nFROM public.orders o", 1, 10, COLUMN_REFERENCE);
    }

    @Test
    void tableReferenceInInsertInto()
    {
        assertContext("INSERT INTO ", 1, 13, TABLE_REFERENCE);
    }

    @Test
    void columnReferenceInInsertColumnList()
    {
        assertContext("INSERT INTO tableB (", 1, 21, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInNonEmptyInsertColumnList()
    {
        assertContext("INSERT INTO tableB (na", 1, 23, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInSelectWithAlias()
    {
        assertContext("SELECT a.name FROM t1 a", 1, 10, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceAfterDot()
    {
        assertContext("SELECT a. FROM t1 a", 1, 10, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInWhereClause()
    {
        assertContext("SELECT * FROM t1 WHERE x = 1", 1, 24, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInOnCondition()
    {
        assertContext("SELECT * FROM t1 JOIN t2 ON t1.x = t2.y", 1, 29, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInOnClause()
    {
        assertContext("SELECT * FROM t1 JOIN t2 ON t1.x = t2.y", 1, 33, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInOnAfterJoinWithAlias()
    {
        assertContext("SELECT *\nFROM dbo.tableA f\nINNER JOIN dbo.tableB p\n    ON ", 4, 7, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceAfterWhereWithRelation()
    {
        assertContext("SELECT *\nFROM dbo.tableA\nWHERE ", 3, 6, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInHaving()
    {
        assertContext("SELECT count(*) FROM t1 HAVING count(*) > 1", 1, 31, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInGroupBy()
    {
        assertContext("SELECT name FROM t1 GROUP BY name", 1, 30, COLUMN_REFERENCE);
    }

    @Test
    void columnReferenceInOrderBy()
    {
        assertContext("SELECT name FROM t1 ORDER BY name", 1, 30, COLUMN_REFERENCE);
    }

    // -- TABLE_REFERENCE (regression) --

    @Test
    void detectsIncompleteFromOnNextLine()
    {
        assertContext("SELECT *\nFROM ", 2, 6, TABLE_REFERENCE);
    }

    @Test
    void detectsIncompleteFromOnSameLine()
    {
        assertContext("SELECT * FROM ", 1, 15, TABLE_REFERENCE);
    }

    @Test
    void detectsIncompleteJoin()
    {
        assertContext("SELECT * FROM t1 JOIN ", 1, 23, TABLE_REFERENCE);
    }

    @Test
    void detectsFromAfterWhereOnPreviousLine()
    {
        assertContext("SELECT * FROM t1 WHERE x = 1\nSELECT *\nFROM ", 3, 5, TABLE_REFERENCE);
    }

    @Test
    void detectsFromAfterCompleteJoinOnPreviousLine()
    {
        assertContext("SELECT * FROM t1 JOIN t2 ON 1 = 1\nSELECT *\nFROM ", 3, 5, TABLE_REFERENCE);
    }

    // -- OTHER tests --

    @Test
    void columnReferenceInSelectStar()
    {
        assertContext("SELECT * FROM t1", 1, 8, COLUMN_REFERENCE);
    }

    @Test
    void returnsOtherForEmptyText()
    {
        TSTree tree = parser.parseString(null, "");
        assertEquals(OTHER, SqlContextDetector.detectContext(tree, 1, 1));
    }

    @Test
    void returnsOtherForSelectOnly()
    {
        assertContext("SELECT *", 1, 9, OTHER);
    }

    private void assertContext(String sql, int line, int column, SqlParseContext expected)
    {
        TSTree tree = parser.parseString(null, sql);
        SqlParseContext result = SqlContextDetector.detectContext(tree, sql, line, column);
        assertEquals(expected, result, "Expected " + expected + " for cursor at (" + line + "," + column + ") in: " + sql);
    }
}
