package com.queryeer.backend.plugin.payloadbuilder.elasticsearch;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;

class ElasticsearchCatalogProviderTest
{
    private static final PayloadMapper TEST_MAPPER = new PayloadMapper()
    {
        private final ObjectMapper objectMapper = new ObjectMapper();

        @Override
        public <T> T convert(Object fromValue, Class<T> toValueType)
        {
            return objectMapper.convertValue(fromValue, toValueType);
        }
    };

    @Test
    void resolveConnectionReturnsConfigFromSettingsModule()
    {
        Map<String, Object> conn = Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440100", "endpoint", "https://localhost:9200", "authType", "BASIC", "authUsername", "elastic", "authPassword",
                Map.of("secretRef", "es-pass"));
        Map<String, Object> values = Map.of("core.queryengine.payloadbuilder.elasticsearch.connections", java.util.List.of(conn));
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
        };

        ElasticsearchCatalogProvider provider = new ElasticsearchCatalogProvider(config, TEST_MAPPER);

        Map<String, Object> resolved = provider.resolveConnection("550e8400-e29b-41d4-a716-446655440100");

        assertNotNull(resolved);
        assertEquals("https://localhost:9200", resolved.get("endpoint"));
        assertEquals("BASIC", resolved.get("authType"));
        assertEquals("elastic", resolved.get("authUsername"));
        assertEquals(Map.of("secretRef", "es-pass"), resolved.get("authPassword"));
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

        ElasticsearchCatalogProvider provider = new ElasticsearchCatalogProvider(config, TEST_MAPPER);

        Map<String, Object> resolved = provider.resolveConnection("nonexistent");

        assertTrue(resolved.isEmpty());
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

        Map<String, Object> resolved = provider.resolveConnection("any");

        assertTrue(resolved.isEmpty());
    }
}
