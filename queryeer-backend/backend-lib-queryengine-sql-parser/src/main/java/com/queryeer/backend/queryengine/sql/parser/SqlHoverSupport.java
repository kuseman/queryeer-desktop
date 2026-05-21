package com.queryeer.backend.queryengine.sql.parser;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.util.Map;

import org.treesitter.TSTree;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;

/** Shared baseline SQL hover support used by query engine providers. */
public final class SqlHoverSupport
{
    private SqlHoverSupport()
    {
    }

    public static Object hover(PayloadMapper payloadMapper, IncrementalParseSessionService parseSessions, String engineId, String fallbackFileId, Object payload,
            SemanticHoverProvider semanticProvider)
    {
        SqlHoverPayload params = payloadMapper.convert(payload, SqlHoverPayload.class);
        SqlHoverCursor cursor = params == null ? null
                : params.cursor();

        String fileId = isBlank(fallbackFileId) ? params == null ? null
                : params.fileId()
                : fallbackFileId;
        if (isBlank(fileId)
                || cursor == null
                || cursor.line() <= 0
                || cursor.column() <= 0)
        {
            return null;
        }

        TSTree tree = null;
        SqlParseContext context = SqlParseContext.OTHER;
        String text = params == null ? null
                : params.text();
        if (!isBlank(text))
        {
            tree = resolveTree(parseSessions, engineId, fileId, text);
            if (tree != null)
            {
                context = SqlContextDetector.detectContext(tree, text, cursor.line(), cursor.column());
            }
        }

        String token = SqlCompletionSupport.identifierAtPosition(parseSessions, engineId, fileId, text, cursor.line(), cursor.column());

        if (semanticProvider == null
                || token == null)
        {
            return null;
        }

        Map<String, String> aliases = tree != null
                && context != SqlParseContext.OTHER ? SqlCompletionSupport.extractAliases(tree, text, cursor.line(), cursor.column())
                        : Map.of();

        Map<String, Object> result = semanticProvider.provide(params, fileId, cursor, token, context, aliases);
        if (result == null)
        {
            return null;
        }
        result.put("context", context.name());
        result.put("token", token);
        return result;
    }

    private static TSTree resolveTree(IncrementalParseSessionService parseSessions, String engineId, String fileId, String text)
    {
        if (!isBlank(text))
        {
            try (org.treesitter.TSParser parser = new org.treesitter.TSParser())
            {
                parser.setLanguage(new org.treesitter.TreeSitterSql());
                return parser.parseString(null, text);
            }
        }
        return null;
    }

    public record SqlHoverPayload(String fileId, String text, SqlHoverCursor cursor, String connectionId, String database)
    {
    }

    public record SqlHoverCursor(int line, int column)
    {
    }

    @FunctionalInterface
    public interface SemanticHoverProvider
    {
        /**
         * @return A map with at least a {@code "contents"} key containing a list of {@code {value, isTrusted}} maps, or {@code null} if no hover information is available.
         */
        Map<String, Object> provide(SqlHoverPayload payload, String fileId, SqlHoverCursor cursor, String token, SqlParseContext context, Map<String, String> aliases);
    }
}
