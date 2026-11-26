package com.queryeer.backend.plugin.payloadbuilder;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;

import se.kuseman.payloadbuilder.api.catalog.Catalog;

class PayloadbuilderCatalogProviderRegistryTest
{
    @Test
    void theBuiltInsAreFilesystemAndHttp()
    {
        // elasticsearch, kafka and mongodb come from their plugins since 0.24
        assertEquals(Set.of("filesystem", "http"), PayloadbuilderCatalogProviderRegistry.defaults()
                .catalogIds());
    }

    @Test
    void aPluginReplacesABuiltInCatalogWithItsActions()
    {
        List<String> log = new ArrayList<>();
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(log::add);
        Contributor plugin = new Contributor("HTTP", Set.of("plugin.http.ping"));

        registry.registerContributor(plugin);

        assertSame(plugin, registry.getCatalogProvider("http"));
        assertEquals(1, registry.catalogIds()
                .stream()
                .filter("http"::equalsIgnoreCase)
                .count());
        assertTrue(registry.actions()
                .contains("plugin.http.ping"));
        assertEquals(List.of("Payloadbuilder catalog 'http': " + Contributor.class.getName() + " replaces the built-in one"), log);
    }

    @Test
    void aReplacedBuiltInsActionsGoWithIt()
    {
        Contributor builtin = new Contributor("weather", Set.of("weather.listStations"));
        PayloadbuilderCatalogProviderRegistry registry = new PayloadbuilderCatalogProviderRegistry(List.of(builtin), message ->
        {
        });

        registry.registerContributor(new Contributor("weather", Set.of("plugin.weather.listStations")));

        assertEquals(Set.of("plugin.weather.listStations"), registry.actions());
    }

    @Test
    void aSecondPluginCantRegisterTheSameCatalog()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults();
        registry.registerContributor(new Contributor("mongodb", Set.of()));

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> registry.registerContributor(new Contributor("MONGODB", Set.of())));

        assertTrue(error.getMessage()
                .contains("is already registered"), error.getMessage());
    }

    @Test
    void theOtherBuiltInsStay()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults();

        registry.registerContributor(new Contributor("http", Set.of()));

        assertEquals(Set.of("filesystem", "http"), registry.catalogIds());
        assertFalse(registry.getCatalogProvider("filesystem") instanceof Contributor);
    }

    private record Contributor(String catalogId, Set<String> actions) implements PayloadbuilderCatalogProviderContributor
    {
        @Override
        public Catalog createCatalog()
        {
            return null;
        }
    }
}
