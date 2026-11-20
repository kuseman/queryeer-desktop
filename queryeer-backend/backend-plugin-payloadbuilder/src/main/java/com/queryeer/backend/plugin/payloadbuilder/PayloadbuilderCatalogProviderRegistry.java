package com.queryeer.backend.plugin.payloadbuilder;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Consumer;

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
 * Registry of catalog provider contributors. Implements the foundation SPI interface so external plugins can contribute catalog providers. Payloadbuilder's own catalogs are built-ins: a plugin that
 * registers a catalog with a built-in's id replaces it, so a plugin can take over a catalog (with its own connections) while Queryeer still ships the built-in.
 */
final class PayloadbuilderCatalogProviderRegistry implements com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderRegistry
{
    private final Map<String, PayloadbuilderCatalogProviderContributor> builtinsByCatalogId = new LinkedHashMap<>();
    private final Map<String, PayloadbuilderCatalogProviderContributor> providersByCatalogId = new LinkedHashMap<>();
    private final Map<String, PayloadbuilderCatalogProviderContributor> providersByAction = new LinkedHashMap<>();
    private final Consumer<String> log;

    private PayloadbuilderCatalogProviderRegistry(List<PayloadbuilderCatalogProviderContributor> builtins, Consumer<String> log)
    {
        this.log = log;
        for (PayloadbuilderCatalogProviderContributor builtin : builtins)
        {
            builtinsByCatalogId.put(builtin.catalogId(), builtin);
            providersByCatalogId.put(builtin.catalogId(), builtin);
            for (String action : builtin.actions())
            {
                providersByAction.put(action, builtin);
            }
        }
    }

    /** Creates the default registry with the catalogs payloadbuilder holds itself. Others (jdbc, from queryengine.payloadbuilder.jdbc) are added with {@link #registerContributor}. */
    static PayloadbuilderCatalogProviderRegistry defaults(ConfigService configService, PayloadMapper payloadMapper)
    {
        return defaults(configService, payloadMapper, message ->
        {
        });
    }

    /** Like {@link #defaults(ConfigService, PayloadMapper)}, telling {@code log} when a plugin replaces a built-in catalog. */
    static PayloadbuilderCatalogProviderRegistry defaults(ConfigService configService, PayloadMapper payloadMapper, Consumer<String> log)
    {
        List<PayloadbuilderCatalogProviderContributor> builtins = List.<PayloadbuilderCatalogProviderContributor>of(new ElasticsearchCatalogProvider(configService, payloadMapper),
                new KafkaCatalogProvider(configService, payloadMapper), new MongoCatalogProvider(configService, payloadMapper), new FilesystemCatalogProvider(), new HttpCatalogProvider());
        return new PayloadbuilderCatalogProviderRegistry(builtins, log);
    }

    @Override
    public synchronized void registerContributor(PayloadbuilderCatalogProviderContributor contributor)
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
        String existingId = catalogIdIgnoringCase(catalogId);
        if (existingId != null)
        {
            PayloadbuilderCatalogProviderContributor existing = providersByCatalogId.get(existingId);
            if (builtinsByCatalogId.get(existingId) != existing)
            {
                throw new IllegalStateException("Payloadbuilder catalog '" + catalogId
                                                + "' is already registered, by "
                                                + existing.getClass()
                                                        .getName()
                                                + "; "
                                                + contributor.getClass()
                                                        .getName()
                                                + " can't register it again");
            }
            // A plugin takes over a built-in catalog, with its actions
            providersByCatalogId.remove(existingId);
            providersByAction.values()
                    .removeIf(provider -> provider == existing);
            log.accept("Payloadbuilder catalog '" + existingId
                       + "': "
                       + contributor.getClass()
                               .getName()
                       + " replaces the built-in one");
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
            // E.g. a built-in catalog's panel calling its action after a plugin replaced that catalog without its frontend
            throw new UnsupportedOperationException("No payloadbuilder catalog provides the action '" + action + "'");
        }
        return provider.invoke(action, payload);
    }

    private PayloadbuilderCatalogProviderContributor providerByCatalogId(String catalogId)
    {
        String key = catalogIdIgnoringCase(catalogId);
        return key == null ? null
                : providersByCatalogId.get(key);
    }

    private String catalogIdIgnoringCase(String catalogId)
    {
        if (catalogId == null)
        {
            return null;
        }
        if (providersByCatalogId.containsKey(catalogId))
        {
            return catalogId;
        }
        for (String key : providersByCatalogId.keySet())
        {
            if (key.equalsIgnoreCase(catalogId))
            {
                return key;
            }
        }
        return null;
    }
}
