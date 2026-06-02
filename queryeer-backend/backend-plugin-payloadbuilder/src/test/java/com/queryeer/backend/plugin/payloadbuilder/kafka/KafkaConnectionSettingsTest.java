package com.queryeer.backend.plugin.payloadbuilder.kafka;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.BOOTSTRAP_SERVERS;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.SASL_JAAS_CONFIG;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.SASL_MECHANISM;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.SCHEMA_REGISTRY_URL;
import static se.kuseman.payloadbuilder.catalog.kafka.KafkaCatalog.SECURITY_PROTOCOL;

import java.util.Properties;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.ConfigService;

import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

class KafkaConnectionSettingsTest
{
    private static final ConfigService NOOP_SECRETS = new ConfigService()
    {
        @Override
        public String get(String key)
        {
            return null;
        }

        @Override
        public Object materializeSecrets(Object payload)
        {
            return payload;
        }
    };

    @Test
    void toClientPropertiesForPlaintext()
    {
        KafkaConnection connection = new KafkaConnection("conn", "Local", "localhost:9092", null, "PLAINTEXT", null, null, true);
        Properties properties = settings().toClientProperties(connection);

        assertEquals("localhost:9092", properties.get("bootstrap.servers"));
        assertEquals("PLAINTEXT", properties.get("security.protocol"));
        assertNull(properties.get("sasl.mechanism"));
        assertNull(properties.get("sasl.jaas.config"));
    }

    @Test
    void toClientPropertiesForSaslPlain()
    {
        KafkaConnection connection = new KafkaConnection("conn", null, "broker:9092", null, "SASL_PLAINTEXT", "PLAIN", "jaas-config", true);
        Properties properties = settings().toClientProperties(connection);

        assertEquals("broker:9092", properties.get("bootstrap.servers"));
        assertEquals("SASL_PLAINTEXT", properties.get("security.protocol"));
        assertEquals("PLAIN", properties.get("sasl.mechanism"));
        assertEquals("jaas-config", properties.get("sasl.jaas.config"));
    }

    @Test
    void toClientPropertiesSkipsGssapiJaas()
    {
        KafkaConnection connection = new KafkaConnection("conn", null, "broker:9092", null, "SASL_SSL", "GSSAPI", "irrelevant", true);
        Properties properties = settings().toClientProperties(connection);

        assertEquals("SASL_SSL", properties.get("security.protocol"));
        assertEquals("GSSAPI", properties.get("sasl.mechanism"));
        assertNull(properties.get("sasl.jaas.config"));
    }

    @Test
    void toClientPropertiesOmitsBlankSecurityProtocol()
    {
        KafkaConnection connection = new KafkaConnection("conn", null, "broker:9092", null, "  ", "PLAIN", "jaas", true);
        Properties properties = settings().toClientProperties(connection);

        assertNull(properties.get("security.protocol"));
        assertNull(properties.get("sasl.mechanism"));
        assertNull(properties.get("sasl.jaas.config"));
    }

    @Test
    void toClientPropertiesMaterializesSecrets()
    {
        ConfigService materializing = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                if (payload instanceof java.util.Map m
                        && m.size() == 1
                        && m.containsKey("secretRef"))
                {
                    return m.get("secretRef");
                }
                return payload;
            }
        };
        KafkaConnectionSettings settings = new KafkaConnectionSettings(materializing);
        KafkaConnection connection = new KafkaConnection("conn", null, "broker:9092", null, "SASL_SSL", "SCRAM-SHA-512", java.util.Map.of("secretRef", "the-secret"), true);

        Properties properties = settings.toClientProperties(connection);

        assertEquals("the-secret", properties.get("sasl.jaas.config"));
    }

    @Test
    void applyToCatalogSetsBootstrapAndSchemaRegistry()
    {
        KafkaConnection connection = new KafkaConnection("conn", null, "broker:9092", "https://schema:8081", "PLAINTEXT", null, null, true);
        QuerySession session = new QuerySession(new CatalogRegistry());
        settings().applyToCatalog(session, "kfk", connection);

        assertEquals("broker:9092", session.getCatalogProperty("kfk", BOOTSTRAP_SERVERS)
                .valueAsString(0));
        assertEquals("https://schema:8081", session.getCatalogProperty("kfk", SCHEMA_REGISTRY_URL)
                .valueAsString(0));
        assertEquals("PLAINTEXT", session.getCatalogProperty("kfk", SECURITY_PROTOCOL)
                .valueAsString(0));
    }

    @Test
    void applyToCatalogSkipsBlankSasl()
    {
        KafkaConnection connection = new KafkaConnection("conn", null, "broker:9092", null, "SASL_SSL", "  ", "jaas", true);
        QuerySession session = new QuerySession(new CatalogRegistry());
        settings().applyToCatalog(session, "kfk", connection);

        assertEquals("SASL_SSL", session.getCatalogProperty("kfk", SECURITY_PROTOCOL)
                .valueAsString(0));
        var saslMechanism = session.getCatalogProperty("kfk", SASL_MECHANISM);
        var saslJaas = session.getCatalogProperty("kfk", SASL_JAAS_CONFIG);
        String saslMechanismValue = saslMechanism == null
                || saslMechanism.size() == 0 ? null
                        : saslMechanism.valueAsString(0);
        String saslJaasValue = saslJaas == null
                || saslJaas.size() == 0 ? null
                        : saslJaas.valueAsString(0);
        assertNull(saslMechanismValue);
        assertNull(saslJaasValue);
    }

    private static KafkaConnectionSettings settings()
    {
        return new KafkaConnectionSettings(NOOP_SECRETS);
    }
}
