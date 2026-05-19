package com.queryeer.backend.plugin.payloadbuilder.elasticsearch;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.core.JacksonPayloadMapper;

import se.kuseman.payloadbuilder.catalog.es.ESCatalog;
import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

class ElasticsearchCatalogProviderTest
{
    private static final PayloadMapper TEST_MAPPER = new JacksonPayloadMapper();

    @Test
    void resolveConnectionReturnsConfigFromSettingsModule()
    {
        Map<String, Object> conn = Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440100", "endpoint", "https://localhost:9200", "authType", "BASIC", "authUsername", "elastic", "authPassword",
                Map.of("secretRef", "es-pass"));
        Map<String, Object> values = Map.of("core.queryengine.payloadbuilder.elasticsearch.connections", List.of(conn));
        SettingsModule module = new SettingsModule("core.queryengine.payloadbuilder.elasticsearch", 1L, "2026-01-01T00:00:00Z", values);

        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return "core.queryengine.payloadbuilder.elasticsearch".equals(moduleId) ? module
                        : null;
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                if (payload instanceof Map m
                        && m.size() == 1
                        && m.containsKey("secretRef"))
                {
                    return m.get("secretRef");
                }
                return payload;
            }
        };

        Map<String, Object> params = Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440100", "index", "myindex");

        ElasticsearchCatalogProvider provider = new ElasticsearchCatalogProvider(config, TEST_MAPPER);
        QuerySession session = new QuerySession(new CatalogRegistry());
        provider.injectProperties(session, "es", params);
        assertEquals("https://localhost:9200", session.getCatalogProperty("es", ESCatalog.ENDPOINT_KEY)
                .valueAsString(0));
        assertEquals("myindex", session.getCatalogProperty("es", ESCatalog.INDEX_KEY)
                .valueAsString(0));
        assertEquals("BASIC", session.getCatalogProperty("es", ESCatalog.AUTH_TYPE_KEY)
                .valueAsString(0));
        assertEquals("elastic", session.getCatalogProperty("es", ESCatalog.AUTH_USERNAME_KEY)
                .valueAsString(0));
        assertEquals("es-pass", session.getCatalogProperty("es", ESCatalog.AUTH_PASSWORD_KEY)
                .valueAsString(0));
    }

    @Test
    void resolveConnectionReturnsEmptyWhenNotFound()
    {
        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return new SettingsModule("core.queryengine.payloadbuilder.elasticsearch", 1L, "2026-01-01T00:00:00Z", Map.of());
            }
        };

        Map<String, Object> params = Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440100", "index", "myindex");

        ElasticsearchCatalogProvider provider = new ElasticsearchCatalogProvider(config, TEST_MAPPER);
        QuerySession session = new QuerySession(new CatalogRegistry());
        assertThrows(IllegalArgumentException.class, () -> provider.injectProperties(session, "es", params));
    }

    @Test
    void resolveConnectionReturnsEmptyWhenModuleNull()
    {
        ConfigService config = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return null;
            }
        };

        ElasticsearchCatalogProvider provider = new ElasticsearchCatalogProvider(config, TEST_MAPPER);

        Map<String, Object> params = Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440100", "index", "myindex");

        QuerySession session = new QuerySession(new CatalogRegistry());
        assertThrows(IllegalArgumentException.class, () -> provider.injectProperties(session, "es", params));
    }
}
