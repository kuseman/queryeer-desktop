package com.queryeer.backend.plugin.payloadbuilder.filesystem;

import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderSystemTableSqlEditorServices;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogSqlEditorServices;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.catalog.fs.FilesystemCatalog;

public class FilesystemCatalogProvider implements PayloadbuilderCatalogProviderContributor
{
    private static final FilesystemCatalog CATALOG = new FilesystemCatalog();

    @Override
    public String catalogId()
    {
        return "filesystem";
    }

    @Override
    public Catalog createCatalog()
    {
        return CATALOG;
    }

    @Override
    public PayloadbuilderCatalogSqlEditorServices editorServices()
    {
        return PayloadbuilderSystemTableSqlEditorServices.INSTANCE;
    }
}
