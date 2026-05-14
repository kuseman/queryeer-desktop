package com.queryeer.backend.queryengine.sql.parser;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import org.junit.jupiter.api.Test;

class SqlDocumentScannerTest
{
    @Test
    void scanRecognizesWordsAndPunctuation()
    {
        List<SqlToken> tokens = SqlDocumentScanner.scan("SELECT a.id FROM dbo.TableA a;");

        assertEquals(
                List.of(SqlTokenType.WORD, SqlTokenType.WORD, SqlTokenType.DOT, SqlTokenType.WORD, SqlTokenType.WORD, SqlTokenType.WORD, SqlTokenType.DOT, SqlTokenType.WORD, SqlTokenType.WORD,
                        SqlTokenType.SEMICOLON),
                tokens.stream()
                        .map(SqlToken::type)
                        .toList());
    }

    @Test
    void scanTreatsClauseKeywordsInsideStringAsString()
    {
        List<SqlToken> tokens = SqlDocumentScanner.scan("SELECT 'FROM table WHERE x = 1' AS value FROM t");

        assertTrue(tokens.stream()
                .anyMatch(token -> token.type() == SqlTokenType.STRING
                        && token.text()
                                .contains("FROM table")));
        assertEquals(1, tokens.stream()
                .filter(token -> token.wordEquals("FROM"))
                .count());
    }

    @Test
    void scanTreatsClauseKeywordsInsideCommentsAsComments()
    {
        List<SqlToken> tokens = SqlDocumentScanner.scan("SELECT * -- FROM ignored\nFROM t /* WHERE ignored */ WHERE id = 1");

        assertEquals(1, tokens.stream()
                .filter(token -> token.wordEquals("FROM"))
                .count());
        assertEquals(1, tokens.stream()
                .filter(token -> token.wordEquals("WHERE"))
                .count());
    }

    @Test
    void statementAtCursorUsesSemicolonBoundary()
    {
        String sql = "SELECT * FROM first; SELECT x FROM second";

        SqlStatementRange range = SqlDocumentScanner.statementAtCursor(sql, 1, 30);

        assertEquals(" SELECT x FROM second", sql.substring(range.startOffset(), range.endOffset()));
    }

    @Test
    void statementAtCursorUsesLineStartSelectAsSoftBoundary()
    {
        String sql = "SELECT * FROM first WHERE id = 1\nSELECT x FROM second";

        SqlStatementRange range = SqlDocumentScanner.statementAtCursor(sql, 2, 16);

        assertEquals("SELECT x FROM second", sql.substring(range.startOffset(), range.endOffset()));
    }

    @Test
    void statementAtCursorIgnoresSelectInsideCommentForSoftBoundary()
    {
        String sql = "SELECT * FROM first\n-- SELECT ignored\nWHERE id = 1";

        SqlStatementRange range = SqlDocumentScanner.statementAtCursor(sql, 3, 8);

        assertEquals(sql, sql.substring(range.startOffset(), range.endOffset()));
    }

    @Test
    void offsetAtHandlesCrLfLines()
    {
        assertEquals(10, SqlDocumentScanner.offsetAt("SELECT 1\r\nFROM t", 2, 1));
    }
}
