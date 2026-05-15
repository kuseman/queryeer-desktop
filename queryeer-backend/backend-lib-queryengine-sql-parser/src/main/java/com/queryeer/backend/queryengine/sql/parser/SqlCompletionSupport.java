package com.queryeer.backend.queryengine.sql.parser;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Stream;

import org.treesitter.TSNode;
import org.treesitter.TSParser;
import org.treesitter.TSPoint;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterSql;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;

/** Shared baseline SQL completion support used by query engine providers. */
public final class SqlCompletionSupport
{
    private static final List<String> SQL_KEYWORDS = List.of("SELECT", "FROM", "WHERE", "GROUP BY", "ORDER BY", "HAVING", "JOIN", "LEFT JOIN", "RIGHT JOIN", "INNER JOIN", "OUTER JOIN", "ON", "INSERT",
            "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "WITH", "UNION", "DISTINCT", "LIMIT", "OFFSET", "AS", "AND", "OR", "NOT", "NULL", "IN", "EXISTS", "CASE", "WHEN", "THEN", "ELSE", "END");

    private SqlCompletionSupport()
    {
    }

    public static Object complete(PayloadMapper payloadMapper, IncrementalParseSessionService parseSessions, String engineId, String fallbackFileId, Object payload)
    {
        return complete(payloadMapper, parseSessions, engineId, fallbackFileId, payload, null);
    }

    public static Object complete(PayloadMapper payloadMapper, IncrementalParseSessionService parseSessions, String engineId, String fallbackFileId, Object payload,
            SemanticCompletionProvider semanticProvider)
    {
        SqlCompletePayload params = payloadMapper.convert(payload, SqlCompletePayload.class);
        SqlCompleteCursor cursor = params == null ? null
                : params.cursor();

        String fileId = isBlank(fallbackFileId) ? params == null ? null
                : params.fileId()
                : fallbackFileId;
        if (isBlank(fileId)
                || cursor == null
                || cursor.line() <= 0
                || cursor.column() <= 0)
        {
            return Map.of("items", List.of(), "isIncomplete", false, "context", Map.of("usedFallback", true));
        }

        String linePrefix = "";
        if (params.text() != null)
        {
            String[] lines = params.text()
                    .split("\\R", -1);
            if (cursor.line() <= lines.length)
            {
                String line = lines[cursor.line() - 1];
                int end = Math.max(0, Math.min(line.length(), cursor.column() - 1));
                linePrefix = line.substring(0, end);
            }
        }
        long requestedVersion = params.version() == null ? 0L
                : params.version();
        Long snapshotVersion = parseSessions.get(engineId, fileId)
                .map(s -> s.version())
                .orElse(null);
        Map<String, Object> context = new LinkedHashMap<>();
        context.put("fileId", fileId);
        context.put("requestedVersion", requestedVersion);
        context.put("snapshotVersion", snapshotVersion);
        context.put("usedFallback", Boolean.FALSE);

        TSTree tree = null;
        SqlParseContext completionContext = SqlParseContext.OTHER;
        if (!isBlank(params == null ? null
                : params.text()))
        {
            tree = resolveTree(parseSessions, engineId, fileId, params.text());
            if (tree != null)
            {
                completionContext = SqlContextDetector.detectContext(tree, params.text(), cursor.line(), cursor.column());
            }
        }
        context.put("completionContext", completionContext.name());

        int maxItems = params != null
                && params.limits() != null
                && params.limits()
                        .maxItems() != null ? Math.max(1, Math.min(500,
                                params.limits()
                                        .maxItems()))
                                : 100;
        String prefix = currentTokenPrefix(linePrefix);
        int replaceStartColumn = Math.max(1, cursor.column() - prefix.length());
        // Extract aliases scoped to the statement containing the cursor
        // (not the entire tree — prevents bleeding across statements)
        Map<String, String> aliases = (tree != null
                && completionContext == SqlParseContext.COLUMN_REFERENCE) ? extractAliases(tree, params.text(), cursor.line(), cursor.column())
                        : Map.of();
        List<Map<String, Object>> semanticItems = semanticProvider == null ? List.of()
                : semanticProvider.provide(params, fileId, cursor, prefix, replaceStartColumn, maxItems, completionContext, aliases);
        Set<String> seenLabels = new LinkedHashSet<>();
        List<Map<String, Object>> items = semanticItems.stream()
                .filter(item -> item != null
                        && item.get("label") instanceof String label
                        && !label.isBlank()
                        && seenLabels.add(label.toLowerCase()))
                .map(item -> withDefaultSortText(item, "0_" + Objects.toString(item.get("label"), "")))
                .limit(maxItems)
                .toList();
        List<Map<String, Object>> keywordItems = SQL_KEYWORDS.stream()
                .filter(keyword -> prefix.isBlank()
                        || keyword.toLowerCase()
                                .startsWith(prefix.toLowerCase()))
                .filter(keyword -> seenLabels.add(keyword.toLowerCase()))
                .limit(Math.max(0, maxItems - items.size()))
                //@formatter:off
                .map(keyword -> Map.<String, Object>of(
                        "label", keyword,
                        "kind", "keyword",
                        "sortText", "9_" + keyword,
                        "insertText", keyword,
                        "insertTextFormat", "plain",
                        "source", "keyword",
                        "replaceRange",
                        Map.of(
                            "startLine", cursor.line(),
                            "startColumn", replaceStartColumn,
                            "endLine", cursor.line(),
                            "endColumn", cursor.column())))
                //@formatter:on
                .toList();
        items = Stream.concat(items.stream(), keywordItems.stream())
                .limit(maxItems)
                .toList();
        return Map.of("items", items, "isIncomplete", false, "context", context);
    }

    // -- Alias extraction --

    /**
     * Walks the tree-sitter AST to extract table aliases from FROM/JOIN clauses using a TSQuery, falling back to text-based regex scanning when the tree cannot be parsed (ERROR nodes).
     *
     * @param line cursor line (1-indexed)
     * @param column cursor column (1-indexed)
     * @return Map of alias → table name (as written in SQL, e.g. "schema.table" or just "table"). Unaliased tables are included with their own name as the alias key.
     */
    public static Map<String, String> extractAliases(TSTree tree, String text, int line, int column)
    {
        if (tree == null
                || isBlank(text))
        {
            return Map.of();
        }
        return SqlRelationExtractor.extractAliases(text, line, column);
    }

    private static TSTree resolveTree(IncrementalParseSessionService parseSessions, String engineId, String fileId, String text)
    {
        // Always parse the text fresh. The session tree can be stale if the
        // file.change notification hasn't arrived before sql.complete.
        if (!isBlank(text))
        {
            try (TSParser parser = new TSParser())
            {
                parser.setLanguage(new TreeSitterSql());
                return parser.parseString(null, text);
            }
        }
        return null;
    }

    private static String currentTokenPrefix(String linePrefix)
    {
        int start = linePrefix.length();
        while (start > 0)
        {
            char c = linePrefix.charAt(start - 1);
            if (Character.isLetterOrDigit(c)
                    || c == '_'
                    || c == '.')
            {
                start--;
                continue;
            }
            break;
        }
        return linePrefix.substring(start);
    }

    public record SqlCompletePayload(String fileId, Long version, String text, String connectionId, String database, SqlCompleteCursor cursor, SqlCompleteLimits limits)
    {
    }

    public record SqlCompleteCursor(int line, int column)
    {
    }

    public record SqlCompleteLimits(Integer maxItems)
    {
    }

    @FunctionalInterface
    public interface SemanticCompletionProvider
    {
        List<Map<String, Object>> provide(SqlCompletePayload payload, String fileId, SqlCompleteCursor cursor, String prefix, int replaceStartColumn, int maxItems, SqlParseContext context,
                Map<String, String> aliases);
    }

    /**
     * Returns the SQL identifier text at the given 1-indexed cursor position, or {@code null} if none. Handles plain identifiers, quoted/bracketed identifiers, and qualified names (schema.table)
     *
     * <p>
     * Always parses {@code text} fresh; the session tree is not used here because tree-sitter-java node byte-position methods return 0 for nodes from a snapshot built on a different document version.
     */
    public static String identifierAtPosition(IncrementalParseSessionService parseSessions, String engineId, String fileId, String text, int line, int column)
    {
        if (line <= 0
                || column <= 0)
        {
            return null;
        }
        TSTree tree = resolveTree(parseSessions, engineId, fileId, text);
        if (tree == null)
        {
            return null;
        }
        // TSPoint is 0-indexed
        TSPoint pt = new TSPoint(line - 1, column - 1);
        TSNode node = tree.getRootNode()
                .getNamedDescendantForPointRange(pt, pt);
        if (node == null
                || node.isNull())
        {
            return null;
        }
        // Guard: if the deepest node's own text is not identifier-like (e.g. an ERROR
        // node spanning multiple tokens, or the cursor landed on whitespace), fall back
        // to raw-text scanning which is immune to tree-sitter byte-range issues.
        int leafStart = node.getStartByte();
        int leafEnd = node.getEndByte();
        if (leafEnd > text.length()
                || leafStart >= leafEnd
                || !isIdentifierText(text.substring(leafStart, leafEnd)))
        {
            return identifierTextAtCursor(text, line, column);
        }
        // Walk up to the widest ancestor whose full text is still a single identifier
        // (no whitespace or structural chars). This captures qualified names like
        // schema.table where the leaf node is the table identifier but the parent
        // object_reference spans the whole qualified name.
        TSNode best = node;
        TSNode parent = node.getParent();
        while (parent != null
                && !parent.isNull())
        {
            // CSOFF
            int pStart = parent.getStartByte();
            int pEnd = parent.getEndByte();
            // CSON
            if (pEnd > text.length())
            {
                break;
            }
            if (!isIdentifierText(text.substring(pStart, pEnd)))
            {
                break;
            }
            best = parent;
            parent = parent.getParent();
        }
        int start = best.getStartByte();
        int end = best.getEndByte();
        if (start < 0
                || end > text.length()
                || start >= end)
        {
            return null;
        }
        return text.substring(start, end)
                .trim();
    }

    /**
     * Extracts the SQL identifier surrounding the 1-indexed cursor position using raw-text scanning, without relying on tree-sitter node byte ranges. Used as a fallback when the tree-sitter node is
     * an ERROR node (which can span multiple tokens) or has an unusable byte range.
     */
    private static String identifierTextAtCursor(String text, int line, int column)
    {
        if (isBlank(text)
                || line <= 0
                || column <= 0)
        {
            return null;
        }
        String[] lines = text.split("\\R", -1);
        if (line > lines.length)
        {
            return null;
        }
        String lineText = lines[line - 1];
        // col0 is the 0-indexed cursor position, clamped to line length
        int col0 = Math.min(column - 1, lineText.length());
        // If the cursor sits on a non-identifier character (e.g. whitespace between
        // two tokens) rather than at the end of the line, there is no identifier here.
        if (col0 < lineText.length()
                && !isIdentifierChar(lineText.charAt(col0)))
        {
            return null;
        }
        // Backward scan for the prefix
        int prefixStart = col0;
        while (prefixStart > 0
                && isIdentifierChar(lineText.charAt(prefixStart - 1)))
        {
            prefixStart--;
        }
        // Forward scan for the suffix
        int suffixEnd = col0;
        while (suffixEnd < lineText.length()
                && isIdentifierChar(lineText.charAt(suffixEnd)))
        {
            suffixEnd++;
        }
        if (prefixStart >= suffixEnd)
        {
            return null;
        }
        String identifier = lineText.substring(prefixStart, suffixEnd);
        return isIdentifierText(identifier) ? identifier
                : null;
    }

    /** Returns true if the string looks like a plain or qualified SQL identifier (no whitespace or structural chars). */
    private static boolean isIdentifierText(String s)
    {
        if (s == null
                || s.isBlank())
        {
            return false;
        }
        for (int i = 0; i < s.length(); i++)
        {
            if (!isIdentifierChar(s.charAt(i)))
            {
                return false;
            }
        }
        return true;
    }

    private static boolean isIdentifierChar(char c)
    {
        return Character.isLetterOrDigit(c)
                || c == '_'
                || c == '.'
                || c == '['
                || c == ']'
                || c == '"'
                || c == '`';
    }

    private static Map<String, Object> withDefaultSortText(Map<String, Object> item, String defaultSortText)
    {
        if (item.get("sortText") instanceof String sortText
                && !sortText.isBlank())
        {
            return item;
        }
        Map<String, Object> updated = new LinkedHashMap<>(item);
        updated.put("sortText", defaultSortText);
        return Map.copyOf(updated);
    }
}
