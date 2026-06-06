package com.queryeer.backend.queryengine.payloadbuilder;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.api.execution.IExecutionContext;
import se.kuseman.payloadbuilder.api.execution.IQuerySession;

/**
 * Optional SQL editor services for a Payloadbuilder catalog provider.
 */
public interface PayloadbuilderCatalogSqlEditorServices
{
    char CATALOG_PREFIX_SEPARATOR = '#';

    PayloadbuilderCatalogSqlEditorServices NONE = new PayloadbuilderCatalogSqlEditorServices()
    {
    };

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

    record CompletionRequest(String catalogAlias, String catalogId, String defaultCatalogAlias, Map<String, Object> properties, Catalog catalog, IQuerySession session,
            IExecutionContext executionContext, String text, String sqlContext, String prefix, int replaceStartColumn, int line, int column, int maxItems, Map<String, String> aliases)
    {
    }

    record CompletionItem(String label, String kind, String detail, String documentation, String insertText, String insertTextFormat, String source)
    {
    }

    record HoverRequest(String catalogAlias, String catalogId, String defaultCatalogAlias, Map<String, Object> properties, Catalog catalog, IQuerySession session, IExecutionContext executionContext,
            String text, String sqlContext, String token, int line, int column, Map<String, String> aliases)
    {
    }

    record Hover(String markdown)
    {
    }

    record SymbolRequest(String catalogAlias, String catalogId, String defaultCatalogAlias, Map<String, Object> properties, Catalog catalog, IQuerySession session, IExecutionContext executionContext,
            String text, String sqlContext, String token, int line, int column, Map<String, String> aliases)
    {
    }

    record Symbol(String kind, String name, String fullName, String detail, Map<String, Object> attributes)
    {
    }

    static Map<String, String> normalizeAliases(Map<String, String> aliases)
    {
        if (aliases == null
                || aliases.isEmpty())
        {
            return aliases;
        }
        Map<String, String> result = new LinkedHashMap<>();
        for (Map.Entry<String, String> entry : aliases.entrySet())
        {
            String key = entry.getKey();
            String value = entry.getValue();
            if (key != null)
            {
                int keySep = key.indexOf(CATALOG_PREFIX_SEPARATOR);
                if (keySep > 0)
                {
                    key = key.substring(keySep + 1);
                }
            }
            if (value != null)
            {
                int sep = value.indexOf(CATALOG_PREFIX_SEPARATOR);
                if (sep > 0)
                {
                    value = value.substring(sep + 1);
                }
            }
            if (!key.equals(value))
            {
                result.put(key, value);
                result.put(value, key);
            }
            else
            {
                result.putIfAbsent(key, value);
            }
        }
        return result;
    }

    static String stripCatalogPrefix(String name)
    {
        if (name == null)
        {
            return null;
        }
        int sep = name.indexOf(CATALOG_PREFIX_SEPARATOR);
        return sep > 0 ? name.substring(sep + 1)
                : name;
    }
}
