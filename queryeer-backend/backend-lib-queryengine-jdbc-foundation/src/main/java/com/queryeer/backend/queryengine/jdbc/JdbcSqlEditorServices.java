package com.queryeer.backend.queryengine.jdbc;

import java.util.List;
import java.util.Map;

/** Optional JDBC-backed SQL editor services shared by query engine integrations. */
public interface JdbcSqlEditorServices
{
    default List<CompletionItem> complete(CompletionRequest request)
    {
        return List.of();
    }

    default Hover hover(HoverRequest request)
    {
        return null;
    }

    default Symbol symbolAtPosition(SymbolRequest request)
    {
        return null;
    }

    record CompletionRequest(String connectionId, String database, String text, String sqlContext, String prefix, int replaceStartColumn, int line, int column, int maxItems,
            Map<String, String> aliases)
    {
    }

    record CompletionItem(String label, String kind, String detail, String documentation, String insertText, String insertTextFormat, String source)
    {
    }

    record HoverRequest(String connectionId, String database, String text, String sqlContext, String token, int line, int column, Map<String, String> aliases)
    {
    }

    record Hover(String markdown)
    {
    }

    record SymbolRequest(String connectionId, String database, String text, String sqlContext, String token, int line, int column, Map<String, String> aliases)
    {
    }

    record Symbol(String kind, String name, String fullName, String detail, Map<String, Object> attributes)
    {
    }
}
