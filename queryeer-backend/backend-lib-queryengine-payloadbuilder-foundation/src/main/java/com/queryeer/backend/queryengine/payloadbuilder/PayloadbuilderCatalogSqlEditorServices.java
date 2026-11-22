package com.queryeer.backend.queryengine.payloadbuilder;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

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

    /**
     * Completion, hover and symbols from the catalog itself: tables and columns from its {@code sys#tables} and {@code sys#columns} system tables, functions from {@link Catalog#getFunctions()}. The
     * metadata is cached for a short while per alias, catalog and properties. For any catalog that implements those system tables, as the built-in catalogs do.
     *
     * @since 0.22.0
     */
    static PayloadbuilderCatalogSqlEditorServices systemTables()
    {
        return PayloadbuilderSystemTableSqlEditorServices.INSTANCE;
    }

    /**
     * As {@link #systemTables()}, plus columns that {@code tableColumns} looks up one table at a time: for a catalog whose {@code sys#columns} can't list them all up front, such as one that samples
     * documents to find a table's fields. Core asks only for a table listed in {@code sys#tables} that the query references: when it completes, hovers or resolves the symbol of a column of it, or
     * hovers the table. Completing or hovering an unqualified column asks for each of the statement's tables of this catalog, one after another.
     *
     * <p>
     * The answer is cached for a short while per table (by its exact listed name), catalog alias and properties, and concurrent requests for a table wait for one lookup. Columns {@code sys#columns}
     * already lists for the table come first, with a type or detail they lack taken from the lookup; other looked-up columns follow. A dotted column name such as {@code payload.orderId} is completed
     * and hovered as {@code p.payload.orderId}.
     * </p>
     *
     * <p>
     * The cache lives in the returned instance, so a provider creates it once and returns the same instance from every {@link PayloadbuilderCatalogProviderContributor#editorServices()} call.
     * Completion waits for the lookup, so {@code tableColumns} bounds its own time. A lookup that throws counts as no columns, until the cached answer expires.
     * </p>
     *
     * @since 0.23.0
     */
    static PayloadbuilderCatalogSqlEditorServices systemTables(TableColumns tableColumns)
    {
        return new PayloadbuilderSystemTableSqlEditorServices(Objects.requireNonNull(tableColumns, "tableColumns"));
    }

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

    /**
     * Looks up one table's columns for {@link #systemTables(TableColumns)}.
     *
     * @since 0.23.0
     */
    @FunctionalInterface
    interface TableColumns
    {
        /** The columns of {@code request.table()}, a name as {@code sys#tables} lists it; an empty list when there are none or they can't be read. */
        List<TableColumn> columns(TableColumnsRequest request);
    }

    /**
     * What {@link TableColumns} is asked: {@code table} is a name as the catalog's {@code sys#tables} lists it, the rest describes the catalog instance as for the other requests.
     *
     * @since 0.23.0
     */
    record TableColumnsRequest(String catalogAlias, String catalogId, Map<String, Object> properties, Catalog catalog, IQuerySession session, IExecutionContext executionContext, String table)
    {
    }

    /**
     * A column {@link TableColumns} found: {@code type} and {@code detail} are optional. {@code detail} is shown in the column's hover and completion documentation, for example how often a sampled
     * field occurred.
     *
     * @since 0.23.0
     */
    record TableColumn(String name, String type, String detail)
    {
        public TableColumn
        {
            Objects.requireNonNull(name, "name");
        }
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
