package com.queryeer.backend.plugin.payloadbuilder;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

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
import com.queryeer.backend.plugin.payloadbuilder.kafka.KafkaCatalogProvider;
import com.queryeer.backend.plugin.payloadbuilder.mongodb.MongoCatalogProvider;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;

import se.kuseman.payloadbuilder.api.catalog.Catalog;

/**
 * Registry of catalog provider contributors. Implements the foundation SPI interface so external plugins can contribute catalog providers.
 */
final class PayloadbuilderCatalogProviderRegistry implements com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderRegistry
{
    private final Map<String, PayloadbuilderCatalogProviderContributor> providersByCatalogId;
    private final Map<String, PayloadbuilderCatalogProviderContributor> providersByAction;

    private PayloadbuilderCatalogProviderRegistry(List<PayloadbuilderCatalogProviderContributor> providers)
    {
        Map<String, PayloadbuilderCatalogProviderContributor> byCatalogId = new LinkedHashMap<>();
        Map<String, PayloadbuilderCatalogProviderContributor> byAction = new LinkedHashMap<>();
        for (PayloadbuilderCatalogProviderContributor provider : providers)
        {
            byCatalogId.put(provider.catalogId(), provider);
            for (String action : provider.actions())
            {
                byAction.put(action, provider);
            }
        }
        this.providersByCatalogId = byCatalogId;
        this.providersByAction = byAction;
    }

    /** Creates the default registry with the catalogs payloadbuilder holds itself. Others (jdbc, from queryengine.payloadbuilder.jdbc) are added with {@link #registerContributor}. */
    static PayloadbuilderCatalogProviderRegistry defaults(ConfigService configService, PayloadMapper payloadMapper)
    {
        List<PayloadbuilderCatalogProviderContributor> builtins = List.<PayloadbuilderCatalogProviderContributor>of(new ElasticsearchCatalogProvider(configService, payloadMapper),
                new KafkaCatalogProvider(configService, payloadMapper), new MongoCatalogProvider(configService, payloadMapper), new FilesystemCatalogProvider(), new HttpCatalogProvider());
        return new PayloadbuilderCatalogProviderRegistry(builtins);
    }

    @Override
    public void registerContributor(PayloadbuilderCatalogProviderContributor contributor)
    {
        if (contributor == null)
        {
            return;
        }
        String catalogId = contributor.catalogId();
        if (isBlank(catalogId))
        {
            throw new IllegalArgumentException("A payloadbuilder catalog contributor needs a catalogId: " + contributor.getClass()
                    .getName());
        }
        // Lookups ignore case, so "JDBC" would shadow "jdbc"
        if (providerByCatalogId(catalogId) != null)
        {
            throw new IllegalStateException("Payloadbuilder catalog '" + catalogId
                                            + "' is already registered, by "
                                            + providerByCatalogId(catalogId).getClass()
                                                    .getName()
                                            + "; "
                                            + contributor.getClass()
                                                    .getName()
                                            + " can't register it again");
        }
        providersByCatalogId.put(catalogId, contributor);
        for (String action : contributor.actions())
        {
            providersByAction.put(action, contributor);
        }
    }

    Catalog createCatalog(String catalogId)
    {
        PayloadbuilderCatalogProviderContributor provider = providerByCatalogId(catalogId);
        return provider == null ? null
                : provider.createCatalog();
    }

    PayloadbuilderCatalogProviderContributor getCatalogProvider(String catalogId)
    {
        return providerByCatalogId(catalogId);
    }

    Set<String> catalogIds()
    {
        return new LinkedHashSet<>(providersByCatalogId.keySet());
    }

    Set<String> actions()
    {
        return new LinkedHashSet<>(providersByAction.keySet());
    }

    Object invoke(String action, Object payload)
    {
        PayloadbuilderCatalogProviderContributor provider = providersByAction.get(action);
        if (provider == null)
        {
            return null;
        }
        return provider.invoke(action, payload);
    }

    private PayloadbuilderCatalogProviderContributor providerByCatalogId(String catalogId)
    {
        PayloadbuilderCatalogProviderContributor provider = providersByCatalogId.get(catalogId);
        if (provider != null)
        {
            return provider;
        }
        for (Map.Entry<String, PayloadbuilderCatalogProviderContributor> entry : providersByCatalogId.entrySet())
        {
            if (entry.getKey()
                    .equalsIgnoreCase(catalogId))
            {
                return entry.getValue();
            }
        }
        return null;
    }
}
