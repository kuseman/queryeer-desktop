package com.queryeer.backend.queryengine.sql.parser;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

class SqlClauseClassifierTest
{
    @Test
    void classifiesFromAsTableReference()
    {
        assertEquals(SqlCompletionContext.TABLE_REFERENCE, SqlClauseClassifier.classify("SELECT * FROM ", 1, 15));
    }

    @Test
    void classifiesJoinAsTableReference()
    {
        assertEquals(SqlCompletionContext.TABLE_REFERENCE, SqlClauseClassifier.classify("SELECT * FROM t JOIN ", 1, 22));
    }

    @Test
    void classifiesWhereAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT * FROM t WHERE ", 1, 23));
    }

    @Test
    void classifiesOnAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT * FROM a JOIN b ON ", 1, 27));
    }

    @Test
    void classifiesGroupByAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT name FROM t GROUP BY ", 1, 29));
    }

    @Test
    void classifiesOrderByAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT name FROM t ORDER BY ", 1, 29));
    }

    @Test
    void classifiesHavingAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT count(*) FROM t HAVING ", 1, 31));
    }

    @Test
    void ignoresClauseWordsInsideStrings()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT 'FROM fake' FROM t WHERE ", 1, 30));
    }

    @Test
    void ignoresClauseWordsInsideComments()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT * FROM t -- WHERE fake\nWHERE ", 2, 7));
    }

    @Test
    void scopesToCurrentLineStartStatementWithoutSemicolon()
    {
        assertEquals(SqlCompletionContext.TABLE_REFERENCE, SqlClauseClassifier.classify("SELECT * FROM t WHERE id = 1\nSELECT *\nFROM ", 3, 6));
    }

    @Test
    void returnsNullForSelectOnlySoAstCanDecide()
    {
        assertNull(SqlClauseClassifier.classify("SELECT ", 1, 8));
    }

    @Test
    void classifiesEmptySelectListBeforeFromAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT \nFROM public.orders o", 1, 8));
    }

    @Test
    void classifiesEmptySelectListBeforeJoinAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT \nFROM public.orders o JOIN public.customers c ON ", 1, 8));
    }

    @Test
    void classifiesNonEmptySelectListBeforeFromAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT na\nFROM public.orders o", 1, 10));
    }

    @Test
    void classifiesQualifiedSelectListBeforeFromAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("SELECT o.\nFROM public.orders o", 1, 10));
    }

    @Test
    void classifiesInsertIntoAsTableReference()
    {
        assertEquals(SqlCompletionContext.TABLE_REFERENCE, SqlClauseClassifier.classify("INSERT INTO ", 1, 13));
    }

    @Test
    void classifiesInsertColumnListAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("INSERT INTO tableB (", 1, 21));
    }

    @Test
    void classifiesNonEmptyInsertColumnListAsColumnReference()
    {
        assertEquals(SqlCompletionContext.COLUMN_REFERENCE, SqlClauseClassifier.classify("INSERT INTO tableB (na", 1, 23));
    }
}
