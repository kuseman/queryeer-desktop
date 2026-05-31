package com.queryeer.example.catalog;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderRegistry;

public final class FakeCatalogBackendPlugin implements BackendPlugin
{
    @Override
    public void activate(BackendPluginContext context, PluginDescriptor descriptor)
    {
        context.services()
                .get(PayloadbuilderCatalogProviderRegistry.class)
                .registerContributor(new FakeCatalogContributor());
        context.logger()
                .info("Activated fake payloadbuilder catalog example plugin");
    }
}
