package com.queryeer.backend.plugin.payloadbuilder.filesystem;

import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderCatalogProvider;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.catalog.fs.FilesystemCatalog;

public class FilesystemCatalogProvider implements PayloadbuilderCatalogProvider
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
}
