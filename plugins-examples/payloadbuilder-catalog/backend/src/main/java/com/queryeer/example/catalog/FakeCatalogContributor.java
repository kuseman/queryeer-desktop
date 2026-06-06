package com.queryeer.example.catalog;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;

import se.kuseman.payloadbuilder.api.catalog.Catalog;

final class FakeCatalogContributor implements PayloadbuilderCatalogProviderContributor
{
    private static final PayloadbuilderCatalogSqlEditorServices EDITOR_SERVICES = new FakeCatalogSqlEditorServices();

    @Override
    public String catalogId()
    {
        return FakeCatalog.CATALOG_ID;
    }

    @Override
    public Catalog createCatalog()
    {
        return new FakeCatalog();
    }

    @Override
    public PayloadbuilderCatalogSqlEditorServices editorServices()
    {
        return EDITOR_SERVICES;
    }

    private static final class FakeCatalogSqlEditorServices implements PayloadbuilderCatalogSqlEditorServices
    {
        private static final String TABLE = "products";
        private static final String FUNCTION = "products_by_category";
        private static final List<String> COLUMNS = List.of("id", "name", "category", "price");

        @Override
        public List<CompletionItem> complete(CompletionRequest request)
        {
            List<CompletionItem> result = new ArrayList<>();
            if ("TABLE_REFERENCE".equals(request.sqlContext()))
            {
                addCompletion(request, result, TABLE, "table", "Fake catalog table", "plain");
                addCompletion(request, result, FUNCTION, "function", "Fake catalog table function", "snippet");
            }
            else if ("COLUMN_REFERENCE".equals(request.sqlContext()))
            {
                for (String column : COLUMNS)
                {
                    if (column.regionMatches(true, 0, request.prefix(), 0, request.prefix()
                            .length()))
                    {
                        result.add(new CompletionItem(column, "column", "Fake catalog column", null, column, "plain", "example.fake"));
                    }
                }
            }
            return result;
        }

        @Override
        public Hover hover(HoverRequest request)
        {
            String tableToken = request.catalogAlias() + "." + TABLE;
            if (TABLE.equalsIgnoreCase(request.token())
                    || tableToken.equalsIgnoreCase(request.token()))
            {
                return new Hover("**Fake Catalog Table: " + displayName(request.catalogAlias(), request.defaultCatalogAlias(), TABLE) + "**\n\n| Column |\n|---|\n| id |\n| name |\n| category |\n| price |\n");
            }
            if (COLUMNS.stream()
                    .anyMatch(column -> column.equalsIgnoreCase(request.token())))
            {
                return new Hover("**Fake Catalog Column: " + request.token() + "**");
            }
            return null;
        }

        @Override
        public Symbol symbolAtPosition(SymbolRequest request)
        {
            String tableToken = request.catalogAlias() + "." + TABLE;
            if (TABLE.equalsIgnoreCase(request.token())
                    || tableToken.equalsIgnoreCase(request.token()))
            {
                String name = displayName(request.catalogAlias(), request.defaultCatalogAlias(), TABLE);
                return new Symbol("table", name, name, "Fake catalog table", Map.of("catalogAlias", request.catalogAlias(), "name", TABLE));
            }
            return null;
        }

        private static void addCompletion(CompletionRequest request, List<CompletionItem> result, String name, String kind, String detail, String insertTextFormat)
        {
            String label = displayName(request.catalogAlias(), request.defaultCatalogAlias(), name);
            if (!label.regionMatches(true, 0, request.prefix(), 0, request.prefix()
                    .length())
                    && !name.regionMatches(true, 0, request.prefix(), 0, request.prefix()
                            .length()))
            {
                return;
            }
            String insertText = "snippet".equals(insertTextFormat) ? label + "(${1})"
                    : label;
            result.add(new CompletionItem(label, kind, detail, null, insertText, insertTextFormat, "example.fake"));
        }

        private static String displayName(String alias, String defaultAlias, String name)
        {
            return alias.equalsIgnoreCase(String.valueOf(defaultAlias)) ? name
                    : alias + "." + name;
        }
    }
}
