package com.queryeer.backend.plugin.payloadbuilder;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.plugin.payloadbuilder.elasticsearch.ElasticsearchCatalogProvider;
import com.queryeer.backend.plugin.payloadbuilder.filesystem.FilesystemCatalogProvider;

import se.kuseman.payloadbuilder.api.catalog.Catalog;

final class PayloadbuilderCatalogProviderRegistry
{
    private final Map<String, PayloadbuilderCatalogProvider> providersByCatalogId;
    private final Map<String, PayloadbuilderCatalogProvider> providersByAction;

    PayloadbuilderCatalogProviderRegistry(List<PayloadbuilderCatalogProvider> providers)
    {
        Map<String, PayloadbuilderCatalogProvider> byCatalogId = new LinkedHashMap<>();
        Map<String, PayloadbuilderCatalogProvider> byAction = new LinkedHashMap<>();
        for (PayloadbuilderCatalogProvider provider : providers)
        {
            byCatalogId.put(provider.catalogId(), provider);
            for (String action : provider.actions())
            {
                byAction.put(action, provider);
            }
        }
        this.providersByCatalogId = Map.copyOf(byCatalogId);
        this.providersByAction = Map.copyOf(byAction);
    }

    static PayloadbuilderCatalogProviderRegistry defaults(ConfigService configService)
    {
        return new PayloadbuilderCatalogProviderRegistry(List.of(new ElasticsearchCatalogProvider(configService), new FilesystemCatalogProvider()));
    }

    Catalog createCatalog(String catalogId)
    {
        PayloadbuilderCatalogProvider provider = providersByCatalogId.get(catalogId);
        return provider == null ? null
                : provider.createCatalog();
    }

    Set<String> catalogIds()
    {
        return providersByCatalogId.keySet();
    }

    Set<String> actions()
    {
        return providersByAction.keySet();
    }

    Object invoke(String action, Object payload)
    {
        PayloadbuilderCatalogProvider provider = providersByAction.get(action);
        if (provider == null)
        {
            throw new IllegalArgumentException("Unsupported payloadbuilder action: " + action);
        }
        return provider.invoke(action, payload);
    }

    /** Resolves connection properties by catalogId + connectionId from ConfigService. */
    Map<String, Object> resolveConnection(String catalogId, String connectionId)
    {
        PayloadbuilderCatalogProvider provider = providersByCatalogId.get(catalogId);
        if (provider != null)
        {
            return provider.resolveConnection(connectionId);
        }
        return Map.of();
    }
}
