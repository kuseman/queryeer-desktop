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

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.core.JacksonPayloadMapper;
import com.queryeer.backend.queryengine.payloadbuilder.PayloadbuilderCatalogProviderContributor;

import se.kuseman.payloadbuilder.api.catalog.Catalog;

class PayloadbuilderCatalogProviderRegistryTest
{
    private static final ConfigService NOOP_CONFIG = _ -> null;

    @Test
    void aPluginReplacesABuiltInCatalogWithItsActions()
    {
        List<String> log = new ArrayList<>();
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, new JacksonPayloadMapper(), log::add);
        Set<String> builtinKafkaActions = registry.getCatalogProvider("kafka")
                .actions();
        assertFalse(builtinKafkaActions.isEmpty(), "the built-in kafka catalog has actions");
        Contributor plugin = new Contributor("Kafka", Set.of("plugin.kafka.listTopics"));

        registry.registerContributor(plugin);

        assertSame(plugin, registry.getCatalogProvider("kafka"));
        assertEquals(1, registry.catalogIds()
                .stream()
                .filter("kafka"::equalsIgnoreCase)
                .count());
        assertTrue(registry.actions()
                .contains("plugin.kafka.listTopics"));
        for (String action : builtinKafkaActions)
        {
            assertFalse(registry.actions()
                    .contains(action), action);
        }
        assertEquals(List.of("Payloadbuilder catalog 'kafka': " + Contributor.class.getName() + " replaces the built-in one"), log);
    }

    @Test
    void aSecondPluginCantRegisterTheSameCatalog()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, new JacksonPayloadMapper());
        registry.registerContributor(new Contributor("mongodb", Set.of()));

        IllegalStateException error = assertThrows(IllegalStateException.class, () -> registry.registerContributor(new Contributor("MONGODB", Set.of())));

        assertTrue(error.getMessage()
                .contains("is already registered"), error.getMessage());
    }

    @Test
    void theOtherBuiltInsStay()
    {
        PayloadbuilderCatalogProviderRegistry registry = PayloadbuilderCatalogProviderRegistry.defaults(NOOP_CONFIG, new JacksonPayloadMapper());

        registry.registerContributor(new Contributor("mongodb", Set.of()));

        assertEquals(Set.of("elasticsearch", "kafka", "mongodb", "filesystem", "http"), registry.catalogIds());
        assertFalse(registry.getCatalogProvider("elasticsearch") instanceof Contributor);
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
