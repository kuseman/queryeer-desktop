package com.queryeer.backend.plugin.payloadbuilder.kafka;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Properties;

import org.apache.kafka.clients.admin.AdminClient;
import org.apache.kafka.clients.admin.AdminClientConfig;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.ConfigService;

class ListTopicsActionHandlerTest
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
    void buildAdminPropertiesStoresTimeoutsAsInteger()
    {
        Properties properties = ListTopicsActionHandler.buildAdminProperties(new KafkaConnectionSettings(NOOP_SECRETS),
                new KafkaConnection("conn", "Local", "localhost:9092", null, "PLAINTEXT", null, null, true));

        Object defaultApi = properties.get(AdminClientConfig.DEFAULT_API_TIMEOUT_MS_CONFIG);
        Object requestTimeout = properties.get(AdminClientConfig.REQUEST_TIMEOUT_MS_CONFIG);

        // Kafka's ConfigDef declares these as Type.INT, so the values must be Integer (not Long) or AdminClient.create throws ConfigException.
        assertInstanceOf(Integer.class, defaultApi);
        assertInstanceOf(Integer.class, requestTimeout);
        assertEquals(30_000, defaultApi);
        assertEquals(30_000, requestTimeout);
    }

    @Test
    void adminClientAcceptsBuiltProperties()
    {
        // Constructing the AdminClient validates the config; an invalid value (e.g. Long where Int is expected) throws ConfigException here without ever contacting the broker.
        Properties properties = ListTopicsActionHandler.buildAdminProperties(new KafkaConnectionSettings(NOOP_SECRETS),
                new KafkaConnection("conn", null, "localhost:1", null, "PLAINTEXT", null, null, true));

        try (AdminClient admin = AdminClient.create(properties))
        {
            assertNotNull(admin);
        }
        catch (org.apache.kafka.common.config.ConfigException e)
        {
            assertTrue(false, "AdminClient.create rejected the built properties: " + e.getMessage());
        }
    }
}
