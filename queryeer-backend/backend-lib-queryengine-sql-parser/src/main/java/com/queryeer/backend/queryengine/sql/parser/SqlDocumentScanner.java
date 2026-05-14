package com.queryeer.backend.queryengine.sql.parser;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.util.ArrayList;
import java.util.List;

final class SqlDocumentScanner
{
    private SqlDocumentScanner()
    {
    }

    static List<SqlToken> scan(String text)
    {
        if (isBlank(text))
        {
            return List.of();
        }
        List<SqlToken> tokens = new ArrayList<>();
        int offset = 0;
        int line = 1;
        int column = 1;
        while (offset < text.length())
        {
            char c = text.charAt(offset);
            if (Character.isWhitespace(c))
            {
                int[] next = advance(text, offset, offset + 1, line, column);
                offset = next[0];
                line = next[1];
                column = next[2];
                continue;
            }

            int startOffset = offset;
            int startLine = line;
            int startColumn = column;
            SqlTokenType type;
            int endOffset;

            if (c == '-'
                    && offset + 1 < text.length()
                    && text.charAt(offset + 1) == '-')
            {
                type = SqlTokenType.LINE_COMMENT;
                endOffset = scanLineComment(text, offset);
            }
            else if (c == '/'
                    && offset + 1 < text.length()
                    && text.charAt(offset + 1) == '*')
            {
                type = SqlTokenType.BLOCK_COMMENT;
                endOffset = scanBlockComment(text, offset);
            }
            else if (c == '\'')
            {
                type = SqlTokenType.STRING;
                endOffset = scanSingleQuoted(text, offset);
            }
            else if (c == '[')
            {
                type = SqlTokenType.QUOTED_IDENTIFIER;
                endOffset = scanBracketQuoted(text, offset);
            }
            else if (c == '"'
                    || c == '`')
            {
                type = SqlTokenType.QUOTED_IDENTIFIER;
                endOffset = scanDelimited(text, offset, c);
            }
            else if (isWordStart(c))
            {
                type = SqlTokenType.WORD;
                endOffset = scanWord(text, offset);
            }
            else
            {
                type = switch (c)
                {
                    case '.' -> SqlTokenType.DOT;
                    case ',' -> SqlTokenType.COMMA;
                    case ';' -> SqlTokenType.SEMICOLON;
                    case '(' -> SqlTokenType.OPEN_PAREN;
                    case ')' -> SqlTokenType.CLOSE_PAREN;
                    case '*', '+', '-', '/', '%', '=', '<', '>', '!' -> SqlTokenType.OPERATOR;
                    default -> SqlTokenType.OTHER;
                };
                endOffset = offset + 1;
            }

            tokens.add(new SqlToken(type, text.substring(startOffset, endOffset), startOffset, endOffset, startLine, startColumn));
            int[] next = advance(text, offset, endOffset, line, column);
            offset = next[0];
            line = next[1];
            column = next[2];
        }
        return List.copyOf(tokens);
    }

    static int offsetAt(String text, int line, int column)
    {
        if (isBlank(text)
                || line <= 0
                || column <= 0)
        {
            return -1;
        }
        int currentLine = 1;
        int lineStart = 0;
        for (int i = 0; i < text.length()
                && currentLine < line; i++)
        {
            if (text.charAt(i) == '\n')
            {
                currentLine++;
                lineStart = i + 1;
            }
        }
        if (currentLine != line)
        {
            return -1;
        }
        int nextLine = text.indexOf('\n', lineStart);
        int lineEnd = nextLine < 0 ? text.length()
                : nextLine;
        return Math.min(lineStart + column - 1, lineEnd);
    }

    static SqlStatementRange statementAtCursor(String text, int line, int column)
    {
        int cursorOffset = offsetAt(text, line, column);
        if (cursorOffset < 0)
        {
            return new SqlStatementRange(0, 0, -1);
        }
        List<SqlToken> tokens = scan(text);
        int start = 0;
        int end = text.length();
        for (SqlToken token : tokens)
        {
            if (token.startOffset() >= cursorOffset)
            {
                break;
            }
            if (token.type() == SqlTokenType.SEMICOLON)
            {
                start = token.endOffset();
            }
            else if (startsSoftStatement(token, text))
            {
                start = token.startOffset();
            }
        }
        for (SqlToken token : tokens)
        {
            if (token.startOffset() < cursorOffset)
            {
                continue;
            }
            if (token.type() == SqlTokenType.SEMICOLON
                    || token.startOffset() > cursorOffset
                            && startsSoftStatement(token, text))
            {
                end = token.startOffset();
                break;
            }
        }
        return new SqlStatementRange(start, end, cursorOffset);
    }

    static List<SqlToken> significantTokensInRange(String text, SqlStatementRange range)
    {
        return scan(text).stream()
                .filter(SqlToken::significant)
                .filter(range::contains)
                .toList();
    }

    private static boolean startsSoftStatement(SqlToken token, String text)
    {
        return token.type() == SqlTokenType.WORD
                && isStatementKeyword(token.text())
                && isLineStartToken(token, text);
    }

    private static boolean isStatementKeyword(String value)
    {
        return "SELECT".equalsIgnoreCase(value)
                || "WITH".equalsIgnoreCase(value)
                || "INSERT".equalsIgnoreCase(value)
                || "UPDATE".equalsIgnoreCase(value)
                || "DELETE".equalsIgnoreCase(value)
                || "CREATE".equalsIgnoreCase(value)
                || "ALTER".equalsIgnoreCase(value)
                || "DROP".equalsIgnoreCase(value)
                || "MERGE".equalsIgnoreCase(value);
    }

    private static boolean isLineStartToken(SqlToken token, String text)
    {
        int offset = token.startOffset() - 1;
        while (offset >= 0)
        {
            char c = text.charAt(offset);
            if (c == '\n'
                    || c == '\r')
            {
                return true;
            }
            if (!Character.isWhitespace(c))
            {
                return false;
            }
            offset--;
        }
        return true;
    }

    private static int scanLineComment(String text, int offset)
    {
        int i = offset + 2;
        while (i < text.length()
                && text.charAt(i) != '\n')
        {
            i++;
        }
        return i;
    }

    private static int scanBlockComment(String text, int offset)
    {
        int i = offset + 2;
        while (i + 1 < text.length())
        {
            if (text.charAt(i) == '*'
                    && text.charAt(i + 1) == '/')
            {
                return i + 2;
            }
            i++;
        }
        return text.length();
    }

    private static int scanSingleQuoted(String text, int offset)
    {
        int i = offset + 1;
        while (i < text.length())
        {
            if (text.charAt(i) == '\'')
            {
                if (i + 1 < text.length()
                        && text.charAt(i + 1) == '\'')
                {
                    i += 2;
                    continue;
                }
                return i + 1;
            }
            i++;
        }
        return text.length();
    }

    private static int scanBracketQuoted(String text, int offset)
    {
        int i = offset + 1;
        while (i < text.length())
        {
            if (text.charAt(i) == ']')
            {
                if (i + 1 < text.length()
                        && text.charAt(i + 1) == ']')
                {
                    i += 2;
                    continue;
                }
                return i + 1;
            }
            i++;
        }
        return text.length();
    }

    private static int scanDelimited(String text, int offset, char delimiter)
    {
        int i = offset + 1;
        while (i < text.length())
        {
            if (text.charAt(i) == delimiter)
            {
                if (i + 1 < text.length()
                        && text.charAt(i + 1) == delimiter)
                {
                    i += 2;
                    continue;
                }
                return i + 1;
            }
            i++;
        }
        return text.length();
    }

    private static int scanWord(String text, int offset)
    {
        int i = offset + 1;
        while (i < text.length()
                && isWordPart(text.charAt(i)))
        {
            i++;
        }
        return i;
    }

    private static boolean isWordStart(char c)
    {
        return Character.isLetter(c)
                || c == '_'
                || c == '#'
                || c == '@';
    }

    private static boolean isWordPart(char c)
    {
        return Character.isLetterOrDigit(c)
                || c == '_'
                || c == '$'
                || c == '#'
                || c == '@';
    }

    private static int[] advance(String text, int start, int end, int line, int column)
    {
        int offset = start;
        int nextLine = line;
        int nextColumn = column;
        while (offset < end)
        {
            char c = text.charAt(offset);
            if (c == '\r')
            {
                if (offset + 1 < end
                        && text.charAt(offset + 1) == '\n')
                {
                    offset++;
                }
                nextLine++;
                nextColumn = 1;
            }
            else if (c == '\n')
            {
                nextLine++;
                nextColumn = 1;
            }
            else
            {
                nextColumn++;
            }
            offset++;
        }
        return new int[] { end, nextLine, nextColumn };
    }
}
