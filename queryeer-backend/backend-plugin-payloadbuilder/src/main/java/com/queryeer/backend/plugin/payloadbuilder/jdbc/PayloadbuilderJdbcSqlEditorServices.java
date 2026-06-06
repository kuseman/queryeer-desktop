package com.queryeer.backend.plugin.payloadbuilder.jdbc;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices.normalizeAliases;
import static com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices.stripCatalogPrefix;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.queryeer.backend.queryengine.jdbc.JdbcSqlEditorServices;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices;

/**
 * Adapts Payloadbuilder JDBC catalog SQL editor service requests to the shared JDBC schema tooling. Prefix, token, and aliases are already normalized by PayloadbuilderSqlSemanticHandler (catalog
 * alias prefix stripped), so this adapter only bridges types.
 */
final class PayloadbuilderJdbcSqlEditorServices implements PayloadbuilderCatalogSqlEditorServices
{
    private static final String KEY_CONNECTION_ID = "connectionId";
    private static final String KEY_DATABASE = "database";

    private final JdbcSqlEditorServices jdbcSqlEditorServices;

    PayloadbuilderJdbcSqlEditorServices(JdbcSqlEditorServices jdbcSqlEditorServices)
    {
        this.jdbcSqlEditorServices = Objects.requireNonNull(jdbcSqlEditorServices, "jdbcSqlEditorServices");
    }

    @Override
    public List<CompletionItem> complete(CompletionRequest request)
    {
        if (request == null)
        {
            return List.of();
        }
        String connectionId = connectionId(request.properties());
        if (connectionId == null)
        {
            return List.of();
        }

        Map<String, String> normalizedAliases = normalizeAliases(request.aliases());
        String prefix = normalizeCatalogDotReference(request.prefix(), request.catalogAlias(), request.aliases());
        List<JdbcSqlEditorServices.CompletionItem> items = jdbcSqlEditorServices.complete(new JdbcSqlEditorServices.CompletionRequest(connectionId, database(request.properties()), request.text(),
                request.sqlContext(), prefix, request.replaceStartColumn(), request.line(), request.column(), request.maxItems(), normalizedAliases));
        if (items == null)
        {
            return List.of();
        }
        return items.stream()
                .filter(Objects::nonNull)
                .map(item -> new CompletionItem(stripCatalogReference(item.label(), request.catalogAlias(), request.aliases()), item.kind(),
                        stripCatalogReference(item.detail(), request.catalogAlias(), request.aliases()), item.documentation(),
                        stripCatalogReference(item.insertText(), request.catalogAlias(), request.aliases()), item.insertTextFormat(), request.catalogAlias()))
                .toList();
    }

    @Override
    public Hover hover(HoverRequest request)
    {
        if (request == null)
        {
            return null;
        }
        String connectionId = connectionId(request.properties());
        if (connectionId == null)
        {
            return null;
        }

        Map<String, String> normalizedAliases = normalizeAliases(request.aliases());
        String token = normalizeCatalogDotReference(request.token(), request.catalogAlias(), request.aliases());
        JdbcSqlEditorServices.Hover hover = jdbcSqlEditorServices.hover(
                new JdbcSqlEditorServices.HoverRequest(connectionId, database(request.properties()), request.text(), request.sqlContext(), token, request.line(), request.column(), normalizedAliases));
        return hover == null ? null
                : new Hover(stripCatalogReference(hover.markdown(), request.catalogAlias(), request.aliases()));
    }

    @Override
    public Symbol symbolAtPosition(SymbolRequest request)
    {
        if (request == null)
        {
            return null;
        }
        String connectionId = connectionId(request.properties());
        if (connectionId == null)
        {
            return null;
        }

        Map<String, String> normalizedAliases = normalizeAliases(request.aliases());
        String token = normalizeCatalogDotReference(request.token(), request.catalogAlias(), request.aliases());
        JdbcSqlEditorServices.Symbol symbol = jdbcSqlEditorServices.symbolAtPosition(new JdbcSqlEditorServices.SymbolRequest(connectionId, database(request.properties()), request.text(),
                request.sqlContext(), token, request.line(), request.column(), normalizedAliases));
        if (symbol == null)
        {
            return null;
        }
        Map<String, Object> attributes = new LinkedHashMap<>();
        if (symbol.attributes() != null)
        {
            attributes.putAll(symbol.attributes());
        }
        attributes.put("catalogAlias", request.catalogAlias());
        return new Symbol(symbol.kind(), stripCatalogReference(symbol.name(), request.catalogAlias(), request.aliases()),
                stripCatalogReference(symbol.fullName(), request.catalogAlias(), request.aliases()), stripCatalogReference(symbol.detail(), request.catalogAlias(), request.aliases()),
                Map.copyOf(attributes));
    }

    private static String connectionId(Map<String, Object> properties)
    {
        if (properties == null)
        {
            return null;
        }
        String connectionId = stringValue(properties, KEY_CONNECTION_ID);
        return isBlank(connectionId) ? null
                : connectionId;
    }

    private static String database(Map<String, Object> properties)
    {
        if (properties == null)
        {
            return null;
        }
        String database = stringValue(properties, KEY_DATABASE);
        return isBlank(database) ? null
                : database;
    }

    private static String normalizeCatalogDotReference(String value, String catalogAlias, Map<String, String> aliases)
    {
        if (isBlank(value)
                || isBlank(catalogAlias)
                || hasExplicitAlias(aliases, catalogAlias))
        {
            return value;
        }
        String dotPrefix = catalogAlias + ".";
        return value.startsWith(dotPrefix) ? value.substring(dotPrefix.length())
                : value;
    }

    private static String stripCatalogReference(String value, String catalogAlias, Map<String, String> aliases)
    {
        String normalized = stripCatalogPrefix(value);
        if (normalized == null
                || isBlank(catalogAlias)
                || hasExplicitAlias(aliases, catalogAlias))
        {
            return normalized;
        }
        String dotPrefix = catalogAlias + ".";
        return normalized.startsWith(dotPrefix) ? normalized.substring(dotPrefix.length())
                : normalized;
    }

    private static boolean hasExplicitAlias(Map<String, String> aliases, String catalogAlias)
    {
        if (aliases == null
                || aliases.isEmpty()
                || isBlank(catalogAlias))
        {
            return false;
        }
        for (String alias : aliases.keySet())
        {
            if (catalogAlias.equalsIgnoreCase(alias))
            {
                return true;
            }
        }
        return false;
    }
}
