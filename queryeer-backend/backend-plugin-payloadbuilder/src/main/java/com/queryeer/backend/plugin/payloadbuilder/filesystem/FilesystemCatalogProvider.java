package com.queryeer.backend.plugin.payloadbuilder.filesystem;

import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderCatalogProvider;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.catalog.fs.FilesystemCatalog;

public class FilesystemCatalogProvider implements PayloadbuilderCatalogProvider
{
    @Override
    public String catalogId()
    {
        return "filesystem";
    }

    @Override
    public Catalog createCatalog()
    {
        return new FilesystemCatalog();
    }
}
