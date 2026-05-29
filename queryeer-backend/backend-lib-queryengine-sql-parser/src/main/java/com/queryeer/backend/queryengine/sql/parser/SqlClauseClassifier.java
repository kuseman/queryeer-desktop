package com.queryeer.backend.queryengine.sql.parser;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.util.List;

final class SqlClauseClassifier
{
    private SqlClauseClassifier()
    {
    }

    static SqlParseContext classify(String text, int line, int column)
    {
        if (isBlank(text))
        {
            return null;
        }
        SqlStatementRange range = SqlDocumentScanner.statementAtCursor(text, line, column);
        if (range.cursorOffset() < 0)
        {
            return null;
        }
        List<SqlToken> statementTokens = SqlDocumentScanner.significantTokensInRange(text, range);
        List<SqlToken> tokens = statementTokens.stream()
                .filter(token -> token.startOffset() < range.cursorOffset())
                .toList();
        SqlParseContext insertContext = classifyInsert(tokens);
        if (insertContext != null)
        {
            return insertContext;
        }
        SqlParseContext procContext = classifyProcedureCall(tokens);
        if (procContext != null)
        {
            return procContext;
        }
        ClauseState lastClause = ClauseState.NONE;

        for (int i = 0; i < tokens.size(); i++)
        {
            SqlToken token = tokens.get(i);
            if (token.type() != SqlTokenType.WORD)
            {
                continue;
            }
            if (token.wordEquals("SELECT"))
            {
                lastClause = ClauseState.SELECT;
            }
            else if (token.wordEquals("FROM")
                    || token.wordEquals("JOIN"))
            {
                lastClause = ClauseState.TABLE;
            }
            else if (token.wordEquals("WHERE")
                    || token.wordEquals("ON")
                    || token.wordEquals("HAVING"))
            {
                lastClause = ClauseState.COLUMN;
            }
            else if (token.wordEquals("GROUP")
                    && nextWordEquals(tokens, i, "BY"))
            {
                lastClause = ClauseState.COLUMN;
            }
            else if (token.wordEquals("ORDER")
                    && nextWordEquals(tokens, i, "BY"))
            {
                lastClause = ClauseState.COLUMN;
            }
        }

        return switch (lastClause)
        {
            case TABLE -> SqlParseContext.TABLE_REFERENCE;
            case COLUMN -> SqlParseContext.COLUMN_REFERENCE;
            case SELECT -> hasRelationAfterCursor(statementTokens, range.cursorOffset()) ? SqlParseContext.COLUMN_REFERENCE
                    : null;
            case NONE -> null;
        };
    }

    private static boolean hasRelationAfterCursor(List<SqlToken> tokens, int cursorOffset)
    {
        return tokens.stream()
                .filter(token -> token.startOffset() >= cursorOffset)
                .anyMatch(token -> token.wordEquals("FROM")
                        || token.wordEquals("JOIN"));
    }

    private static SqlParseContext classifyProcedureCall(List<SqlToken> tokens)
    {
        for (SqlToken token : tokens)
        {
            if (token.type() == SqlTokenType.WORD
                    && (token.wordEquals("CALL")
                            || token.wordEquals("EXEC")))
            {
                return SqlParseContext.PROCEDURE_CALL;
            }
        }
        return null;
    }

    private static SqlParseContext classifyInsert(List<SqlToken> tokens)
    {
        int insertIndex = firstWordIndex(tokens, "INSERT");
        if (insertIndex < 0)
        {
            return null;
        }
        int intoIndex = nextWordIndex(tokens, insertIndex, "INTO");
        if (intoIndex < 0)
        {
            return null;
        }
        QualifiedName tableName = readQualifiedName(tokens, intoIndex + 1);
        if (tableName == null)
        {
            return SqlParseContext.TABLE_REFERENCE;
        }
        return isInsideInsertColumnList(tokens, tableName.nextIndex()) ? SqlParseContext.COLUMN_REFERENCE
                : null;
    }

    private static boolean isInsideInsertColumnList(List<SqlToken> tokens, int index)
    {
        if (index >= tokens.size()
                || tokens.get(index)
                        .type() != SqlTokenType.OPEN_PAREN)
        {
            return false;
        }
        int depth = 0;
        for (int i = index; i < tokens.size(); i++)
        {
            SqlToken token = tokens.get(i);
            if (token.type() == SqlTokenType.OPEN_PAREN)
            {
                depth++;
            }
            else if (token.type() == SqlTokenType.CLOSE_PAREN)
            {
                depth--;
            }
            else if (depth <= 0
                    && (token.wordEquals("VALUES")
                            || token.wordEquals("SELECT")))
            {
                return false;
            }
        }
        return depth > 0;
    }

    private static int firstWordIndex(List<SqlToken> tokens, String value)
    {
        return nextWordIndex(tokens, -1, value);
    }

    private static int nextWordIndex(List<SqlToken> tokens, int index, String value)
    {
        for (int i = index + 1; i < tokens.size(); i++)
        {
            if (tokens.get(i)
                    .wordEquals(value))
            {
                return i;
            }
        }
        return -1;
    }

    private static QualifiedName readQualifiedName(List<SqlToken> tokens, int index)
    {
        if (index >= tokens.size()
                || !isNamePart(tokens.get(index)))
        {
            return null;
        }
        int i = index + 1;
        while (i + 1 < tokens.size()
                && tokens.get(i)
                        .type() == SqlTokenType.DOT
                && isNamePart(tokens.get(i + 1)))
        {
            i += 2;
        }
        return new QualifiedName(i);
    }

    private static boolean isNamePart(SqlToken token)
    {
        return token.type() == SqlTokenType.WORD
                || token.type() == SqlTokenType.QUOTED_IDENTIFIER;
    }

    private static boolean nextWordEquals(List<SqlToken> tokens, int index, String value)
    {
        for (int i = index + 1; i < tokens.size(); i++)
        {
            SqlToken token = tokens.get(i);
            if (token.type() == SqlTokenType.COMMA)
            {
                continue;
            }
            return token.wordEquals(value);
        }
        return false;
    }

    private enum ClauseState
    {
        NONE,
        SELECT,
        TABLE,
        COLUMN
    }

    private record QualifiedName(int nextIndex)
    {
    }
}
