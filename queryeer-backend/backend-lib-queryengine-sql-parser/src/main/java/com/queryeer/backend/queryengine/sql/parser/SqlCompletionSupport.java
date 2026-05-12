package com.queryeer.backend.queryengine.sql.parser;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Stream;

import org.treesitter.TSParser;
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

        SqlCompletionContext completionContext = SqlCompletionContext.OTHER;
        if (!isBlank(params == null ? null
                : params.text()))
        {
            TSTree tree = resolveTree(parseSessions, engineId, fileId, params.text());
            if (tree != null)
            {
                completionContext = SqlContextDetector.detectContext(tree, cursor.line(), cursor.column());
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
        List<Map<String, Object>> semanticItems = semanticProvider == null ? List.of()
                : semanticProvider.provide(params, fileId, cursor, prefix, replaceStartColumn, maxItems, completionContext);
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
                        "insertText", keyword + " ",
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

    private static TSTree resolveTree(IncrementalParseSessionService parseSessions, String engineId, String fileId, String text)
    {
        // Always parse the text fresh. The session tree can be stale if the
        // file.change notification hasn't arrived before sql.complete.
        if (!isBlank(text))
        {
            TSParser parser = new TSParser();
            parser.setLanguage(new TreeSitterSql());
            return parser.parseString(null, text);
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
        List<Map<String, Object>> provide(SqlCompletePayload payload, String fileId, SqlCompleteCursor cursor, String prefix, int replaceStartColumn, int maxItems, SqlCompletionContext context);
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
