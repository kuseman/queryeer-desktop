package com.queryeer.backend.queryengine.sql.parser;

import java.util.ArrayList;
import java.util.List;

/**
 * Splits SQL text into individual statements using semicolons as delimiters while respecting string literals, comments, and parenthesis depth.
 */
public final class SqlStatementSplitter
{
    /**
     * Splits the given SQL text into individual statements. Each statement is trimmed; empty segments are discarded.
     */
    public static List<String> split(String sql)
    {
        if (sql == null
                || sql.isBlank())
        {
            return List.of(sql == null ? ""
                    : sql);
        }

        List<SqlToken> tokens = SqlDocumentScanner.scan(sql);
        List<String> statements = new ArrayList<>();
        int start = 0;
        int depth = 0;

        for (SqlToken token : tokens)
        {
            if (token.type() == SqlTokenType.SEMICOLON
                    && depth == 0)
            {
                String stmt = sql.substring(start, token.startOffset())
                        .trim();
                if (!stmt.isEmpty())
                {
                    statements.add(stmt);
                }
                start = token.endOffset();
            }
            depth = updateDepth(depth, token);
        }

        String remaining = sql.substring(start)
                .trim();
        if (!remaining.isEmpty())
        {
            statements.add(remaining);
        }

        return statements.isEmpty() ? List.of(sql.trim())
                : statements;
    }

    private static int updateDepth(int depth, SqlToken token)
    {
        if (token.type() == SqlTokenType.OPEN_PAREN)
        {
            return depth + 1;
        }
        if (token.type() == SqlTokenType.CLOSE_PAREN)
        {
            return Math.max(0, depth - 1);
        }
        return depth;
    }

    private SqlStatementSplitter()
    {
    }
}
