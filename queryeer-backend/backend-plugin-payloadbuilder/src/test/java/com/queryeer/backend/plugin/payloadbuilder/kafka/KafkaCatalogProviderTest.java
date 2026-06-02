package com.queryeer.backend.plugin.payloadbuilder.kafka;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.core.JacksonPayloadMapper;

import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

class KafkaCatalogProviderTest
{
    private static final PayloadMapper TEST_MAPPER = new JacksonPayloadMapper();
    private static final String KAFKA_MODULE_ID = "core.queryengine.payloadbuilder.kafka";
    private static final String KAFKA_CONNECTIONS_SETTING_ID = "core.queryengine.payloadbuilder.kafka.connections";

    @Test
    void resolveConnectionReturnsConfigFromSettingsModule()
    {
        Map<String, Object> conn = Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440200", "title", "Dev", "bootstrapServers", "localhost:9092", "schemaRegistryUrl", "http://localhost:8081",
                "securityProtocol", "SASL_SSL", "saslMechanism", "PLAIN", "saslJaasConfig", Map.of("secretRef", "kafka-jaas"), "enabled", true);
        Map<String, Object> values = Map.of(KAFKA_CONNECTIONS_SETTING_ID, List.of(conn));
        SettingsModule module = new SettingsModule(KAFKA_MODULE_ID, 1L, "2026-01-01T00:00:00Z", values);

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
                return KAFKA_MODULE_ID.equals(moduleId) ? module
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

        Map<String, Object> params = Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440200", "topic", "orders");

        KafkaCatalogProvider provider = new KafkaCatalogProvider(config, TEST_MAPPER);
        QuerySession session = new QuerySession(new CatalogRegistry());
        provider.injectProperties(session, "kfk", params);

        assertEquals("localhost:9092", session.getCatalogProperty("kfk", "bootstrap_servers")
                .valueAsString(0));
        assertEquals("http://localhost:8081", session.getCatalogProperty("kfk", "schema_registry_url")
                .valueAsString(0));
        assertEquals("SASL_SSL", session.getCatalogProperty("kfk", "security_protocol")
                .valueAsString(0));
        assertEquals("PLAIN", session.getCatalogProperty("kfk", "sasl_mechanism")
                .valueAsString(0));
        assertEquals("kafka-jaas", session.getCatalogProperty("kfk", "sasl_jaas_config")
                .valueAsString(0));
        assertEquals("orders", session.getCatalogProperty("kfk", "topic")
                .valueAsString(0));
    }

    @Test
    void resolveConnectionReturnsNullWhenConnectionIdBlank()
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
                return new SettingsModule(KAFKA_MODULE_ID, 1L, "2026-01-01T00:00:00Z", Map.of());
            }
        };

        KafkaCatalogProvider provider = new KafkaCatalogProvider(config, TEST_MAPPER);
        assertNull(provider.getConnection(""));
        assertNull(provider.getConnection(null));
    }

    @Test
    void resolveConnectionReturnsNullWhenModuleNull()
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

        KafkaCatalogProvider provider = new KafkaCatalogProvider(config, TEST_MAPPER);
        assertNull(provider.getConnection("anything"));
    }

    @Test
    void injectPropertiesThrowsWhenConnectionMissing()
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
                return new SettingsModule(KAFKA_MODULE_ID, 1L, "2026-01-01T00:00:00Z", Map.of());
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return payload;
            }
        };

        KafkaCatalogProvider provider = new KafkaCatalogProvider(config, TEST_MAPPER);
        QuerySession session = new QuerySession(new CatalogRegistry());
        assertThrows(IllegalArgumentException.class, () -> provider.injectProperties(session, "kfk", Map.of("connectionId", "missing")));
    }

    @Test
    void injectPropertiesThrowsWhenBootstrapServersMissing()
    {
        Map<String, Object> conn = Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440200", "bootstrapServers", "  ", "enabled", true);
        Map<String, Object> values = Map.of(KAFKA_CONNECTIONS_SETTING_ID, List.of(conn));
        SettingsModule module = new SettingsModule(KAFKA_MODULE_ID, 1L, "2026-01-01T00:00:00Z", values);

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
                return KAFKA_MODULE_ID.equals(moduleId) ? module
                        : null;
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                return payload;
            }
        };

        KafkaCatalogProvider provider = new KafkaCatalogProvider(config, TEST_MAPPER);
        QuerySession session = new QuerySession(new CatalogRegistry());
        assertThrows(IllegalArgumentException.class, () -> provider.injectProperties(session, "kfk", Map.of("connectionId", "550e8400-e29b-41d4-a716-446655440200")));
    }
}
