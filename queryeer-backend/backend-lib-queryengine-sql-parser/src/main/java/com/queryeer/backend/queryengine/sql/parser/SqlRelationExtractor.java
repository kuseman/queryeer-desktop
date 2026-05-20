package com.queryeer.backend.queryengine.sql.parser;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.treesitter.TSNode;
import org.treesitter.TSParser;
import org.treesitter.TSQuery;
import org.treesitter.TSQueryCapture;
import org.treesitter.TSQueryCursor;
import org.treesitter.TSQueryMatch;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterSql;

final class SqlRelationExtractor
{
    private static final TSQuery RELATION_QUERY = new TSQuery(new TreeSitterSql(), "(relation) @rel");

    private SqlRelationExtractor()
    {
    }

    static Map<String, String> extractAliases(String text, int line, int column)
    {
        if (isBlank(text))
        {
            return Map.of();
        }
        SqlStatementRange range = SqlDocumentScanner.statementAtCursor(text, line, column);
        if (range.cursorOffset() < 0)
        {
            return Map.of();
        }
        String scopedText = text.substring(range.startOffset(), range.endOffset());
        int scopedCursorOffset = range.cursorOffset() - range.startOffset();
        Map<String, String> aliases = new LinkedHashMap<>();
        aliases.putAll(extractWithScanner(scopedText, scopedCursorOffset));
        extractWithTreeSitter(scopedText).forEach(aliases::putIfAbsent);
        return Map.copyOf(aliases);
    }

    private static Map<String, String> extractWithTreeSitter(String text)
    {
        Map<String, String> aliases = new LinkedHashMap<>();
        try (TSParser parser = new TSParser())
        {
            parser.setLanguage(new TreeSitterSql());
            TSTree tree = parser.parseString(null, text);
            try (TSQueryCursor cursor = new TSQueryCursor())
            {
                cursor.exec(RELATION_QUERY, tree.getRootNode());
                TSQueryMatch match = new TSQueryMatch();
                while (cursor.nextMatch(match))
                {
                    for (TSQueryCapture capture : match.getCaptures())
                    {
                        TSNode relNode = capture.getNode();
                        String tableName = tableNameForRelation(text, relNode);
                        if (tableName != null)
                        {
                            String alias = aliasForRelation(text, relNode);
                            String key = alias != null ? alias.toLowerCase(Locale.ROOT)
                                    : tableName.toLowerCase(Locale.ROOT);
                            aliases.putIfAbsent(key, tableName);
                        }
                    }
                }
            }
        }
        return aliases;
    }

    private static Map<String, String> extractWithScanner(String text, int cursorOffset)
    {
        Map<String, String> aliases = new LinkedHashMap<>();
        List<SqlToken> tokens = SqlDocumentScanner.scan(text)
                .stream()
                .filter(SqlToken::significant)
                .toList();
        List<SqlToken> tokensBeforeCursor = tokens.stream()
                .filter(token -> token.startOffset() < cursorOffset)
                .toList();
        extractInsertTarget(tokensBeforeCursor).forEach(aliases::putIfAbsent);
        boolean inFromList = false;
        for (int i = 0; i < tokens.size(); i++)
        {
            SqlToken token = tokens.get(i);
            if (isClauseBoundary(token))
            {
                inFromList = false;
            }
            boolean relationStart = token.wordEquals("FROM")
                    || token.wordEquals("JOIN")
                    || inFromList
                            && token.type() == SqlTokenType.COMMA;
            if (!relationStart)
            {
                continue;
            }
            inFromList = true;
            int tableIndex = i + 1;
            while (tableIndex < tokens.size()
                    && isJoinModifier(tokens.get(tableIndex)))
            {
                tableIndex++;
            }
            QualifiedName tableName = readQualifiedName(tokens, tableIndex);
            if (tableName == null)
            {
                continue;
            }
            int aliasIndex = tableName.nextIndex();
            if (aliasIndex < tokens.size()
                    && tokens.get(aliasIndex)
                            .wordEquals("AS"))
            {
                aliasIndex++;
            }
            String alias = null;
            if (aliasIndex < tokens.size()
                    && isAliasToken(tokens.get(aliasIndex)))
            {
                alias = unquote(tokens.get(aliasIndex)
                        .text());
            }
            aliases.putIfAbsent(alias != null ? alias.toLowerCase(Locale.ROOT)
                    : tableName.name()
                            .toLowerCase(Locale.ROOT),
                    tableName.name());
        }
        return aliases;
    }

    private static Map<String, String> extractInsertTarget(List<SqlToken> tokens)
    {
        int insertIndex = firstWordIndex(tokens, "INSERT");
        if (insertIndex < 0)
        {
            return Map.of();
        }
        int intoIndex = nextWordIndex(tokens, insertIndex, "INTO");
        if (intoIndex < 0)
        {
            return Map.of();
        }
        QualifiedName tableName = readQualifiedName(tokens, intoIndex + 1);
        if (tableName == null
                || !isInsideColumnList(tokens, tableName.nextIndex()))
        {
            return Map.of();
        }
        return Map.of(tableName.name()
                .toLowerCase(Locale.ROOT), tableName.name());
    }

    private static boolean isInsideColumnList(List<SqlToken> tokens, int index)
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
        StringBuilder builder = new StringBuilder(unquote(tokens.get(index)
                .text()));
        int i = index + 1;
        while (i + 1 < tokens.size()
                && tokens.get(i)
                        .type() == SqlTokenType.DOT
                && isNamePart(tokens.get(i + 1)))
        {
            builder.append('.')
                    .append(unquote(tokens.get(i + 1)
                            .text()));
            i += 2;
        }
        return new QualifiedName(builder.toString(), i);
    }

    private static boolean isAliasToken(SqlToken token)
    {
        return isNamePart(token)
                && !isReservedAfterRelation(token);
    }

    private static boolean isNamePart(SqlToken token)
    {
        return token.type() == SqlTokenType.WORD
                || token.type() == SqlTokenType.QUOTED_IDENTIFIER;
    }

    private static boolean isReservedAfterRelation(SqlToken token)
    {
        return token.wordEquals("WHERE")
                || token.wordEquals("GROUP")
                || token.wordEquals("ORDER")
                || token.wordEquals("HAVING")
                || token.wordEquals("LIMIT")
                || token.wordEquals("OFFSET")
                || token.wordEquals("ON")
                || token.wordEquals("JOIN")
                || token.wordEquals("INNER")
                || token.wordEquals("LEFT")
                || token.wordEquals("RIGHT")
                || token.wordEquals("FULL")
                || token.wordEquals("CROSS")
                || token.wordEquals("OUTER")
                || token.wordEquals("NATURAL")
                || token.wordEquals("USING");
    }

    private static boolean isJoinModifier(SqlToken token)
    {
        return token.wordEquals("INNER")
                || token.wordEquals("LEFT")
                || token.wordEquals("RIGHT")
                || token.wordEquals("FULL")
                || token.wordEquals("CROSS")
                || token.wordEquals("OUTER")
                || token.wordEquals("NATURAL");
    }

    private static boolean isClauseBoundary(SqlToken token)
    {
        return token.wordEquals("WHERE")
                || token.wordEquals("GROUP")
                || token.wordEquals("ORDER")
                || token.wordEquals("HAVING")
                || token.wordEquals("LIMIT")
                || token.wordEquals("OFFSET")
                || token.wordEquals("UNION");
    }

    private static String unquote(String value)
    {
        if (value.length() >= 2)
        {
            char first = value.charAt(0);
            char last = value.charAt(value.length() - 1);
            if (first == '['
                    && last == ']')
            {
                return value.substring(1, value.length() - 1)
                        .replace("]]", "]");
            }
            if ((first == '"'
                    && last == '"')
                    || first == '`'
                            && last == '`')
            {
                return value.substring(1, value.length() - 1)
                        .replace(String.valueOf(first) + first, String.valueOf(first));
            }
        }
        return value;
    }

    private static String tableNameForRelation(String text, TSNode relation)
    {
        for (int i = 0; i < relation.getNamedChildCount(); i++)
        {
            TSNode child = relation.getNamedChild(i);
            if ("object_reference".equals(child.getType()))
            {
                return nodeText(text, child);
            }
        }
        return null;
    }

    private static String aliasForRelation(String text, TSNode relation)
    {
        TSNode aliasNode = relation.getChildByFieldName("alias");
        if (aliasNode != null
                && !aliasNode.isNull())
        {
            return nodeText(text, aliasNode);
        }
        return null;
    }

    private static String nodeText(String text, TSNode node)
    {
        int start = node.getStartByte();
        int end = node.getEndByte();
        if (start >= 0
                && end <= text.length()
                && start < end)
        {
            return text.substring(start, end)
                    .trim();
        }
        return null;
    }

    private record QualifiedName(String name, int nextIndex)
    {
    }
}
