package com.queryeer.example.catalog;

import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;

import se.kuseman.payloadbuilder.api.catalog.Catalog;

final class FakeCatalogContributor implements PayloadbuilderCatalogProviderContributor
{
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
}
