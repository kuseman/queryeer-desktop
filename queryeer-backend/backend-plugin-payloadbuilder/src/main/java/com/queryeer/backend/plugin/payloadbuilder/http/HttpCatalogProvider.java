package com.queryeer.backend.plugin.payloadbuilder.http;

import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderCatalogProvider;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.catalog.http.HttpCatalog;

public class HttpCatalogProvider implements PayloadbuilderCatalogProvider
{
    private static final HttpCatalog CATALOG = new HttpCatalog();

    @Override
    public String catalogId()
    {
        return "http";
    }

    @Override
    public Catalog createCatalog()
    {
        return CATALOG;
    }
}
