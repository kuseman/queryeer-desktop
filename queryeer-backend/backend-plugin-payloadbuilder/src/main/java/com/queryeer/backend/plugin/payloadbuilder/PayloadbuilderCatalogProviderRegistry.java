package com.queryeer.backend.plugin.payloadbuilder;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.plugin.payloadbuilder.elasticsearch.ElasticsearchCatalogProvider;
import com.queryeer.backend.plugin.payloadbuilder.filesystem.FilesystemCatalogProvider;
import com.queryeer.backend.plugin.payloadbuilder.http.HttpCatalogProvider;
import com.queryeer.backend.plugin.payloadbuilder.jdbc.JdbcCatalogProvider;
import com.queryeer.backend.queryengine.jdbc.JdbcRuntimeService;

import se.kuseman.payloadbuilder.api.catalog.Catalog;

final class PayloadbuilderCatalogProviderRegistry
{
    private final Map<String, PayloadbuilderCatalogProvider> builtinsByCatalogId;
    private final Map<String, PayloadbuilderCatalogProvider> builtinsByAction;

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
        this.builtinsByCatalogId = Map.copyOf(byCatalogId);
        this.builtinsByAction = Map.copyOf(byAction);
    }

    static PayloadbuilderCatalogProviderRegistry defaults(ConfigService configService, PayloadMapper payloadMapper, JdbcRuntimeService jdbcRuntimeServices)
    {
        return new PayloadbuilderCatalogProviderRegistry(
                List.of(new JdbcCatalogProvider(jdbcRuntimeServices), new ElasticsearchCatalogProvider(configService, payloadMapper), new FilesystemCatalogProvider(), new HttpCatalogProvider()));
    }

    Catalog createCatalog(String catalogId)
    {
        PayloadbuilderCatalogProvider provider = providerByCatalogId(catalogId);
        return provider == null ? null
                : provider.createCatalog();
    }

    PayloadbuilderCatalogProvider getCatalogProvider(String catalogId)
    {
        PayloadbuilderCatalogProvider provider = providerByCatalogId(catalogId);
        return provider;
    }

    Set<String> catalogIds()
    {
        Set<String> ids = new LinkedHashSet<>(builtinsByCatalogId.keySet());
        return ids;
    }

    Set<String> actions()
    {
        Set<String> actions = new LinkedHashSet<>(builtinsByAction.keySet());
        return actions;
    }

    Object invoke(String action, Object payload)
    {
        PayloadbuilderCatalogProvider provider = providerByAction(action);
        if (provider == null)
        {
            return null;
        }
        return provider.invoke(action, payload);
    }

    private PayloadbuilderCatalogProvider providerByCatalogId(String catalogId)
    {
        PayloadbuilderCatalogProvider provider = builtinsByCatalogId.get(catalogId);
        if (provider != null)
        {
            return provider;
        }
        for (Map.Entry<String, PayloadbuilderCatalogProvider> entry : builtinsByCatalogId.entrySet())
        {
            if (entry.getKey()
                    .equalsIgnoreCase(catalogId))
            {
                return entry.getValue();
            }
        }
        return null;
    }

    private PayloadbuilderCatalogProvider providerByAction(String action)
    {
        PayloadbuilderCatalogProvider provider = builtinsByAction.get(action);
        if (provider != null)
        {
            return provider;
        }
        return null;
    }
}
