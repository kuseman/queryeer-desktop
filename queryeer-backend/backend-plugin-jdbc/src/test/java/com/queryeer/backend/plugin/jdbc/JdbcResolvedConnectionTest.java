package com.queryeer.backend.plugin.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.queryengine.jdbc.DefaultJdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

class JdbcResolvedConnectionTest
{
    private static final ConfigService NOOP_CONFIG = new ConfigService()
    {
        @Override
        public String get(String key)
        {
            return null;
        }
    };

    @Test
    void fromEngineStateResolvesConnectionFromRegistry()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("prod-db", "Production", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "username", "sa", "password", "secret"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "prod-db"), connections, registry, NOOP_CONFIG);

        assertEquals("prod-db", resolved.connectionId());
        assertNotNull(resolved.dialect());
        assertNotNull(resolved.profile());
        assertEquals("jdbc", resolved.profile()
                .dialectId());
    }

    @Test
    void fromEngineStateThrowsOnUnknownConnection()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "unknown"), connections, registry, NOOP_CONFIG));
    }

    @Test
    void fromPayloadResolvesFullConnectionForTesting()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromPayload(Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "username", "sa", "password", "secret"), registry, NOOP_CONFIG);

        assertNotNull(resolved.profile());
        assertEquals("jdbc", resolved.profile()
                .dialectId());
    }

    @Test
    void fromPayloadDefaultsDialectToJdbc()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromPayload(Map.of("url", "jdbc:h2:mem:test"), registry, NOOP_CONFIG);

        assertEquals("jdbc", resolved.profile()
                .dialectId());
    }

    @Test
    void fromRegistryWithOverridesMergesProperties()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("prod-db", "Production", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:stored", "username", "stored-user", "password", "stored-pw"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromRegistryWithOverrides(Map.of("connectionId", "prod-db", "properties", Map.of("schema", "override")), connections, registry,
                NOOP_CONFIG);

        assertEquals("prod-db", resolved.connectionId());
        assertEquals("override", resolved.profile()
                .properties()
                .get("schema"));
        assertEquals("jdbc:h2:mem:stored", resolved.profile()
                .properties()
                .get("url"));
    }

    @Test
    void materializesSecretRefs()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("prod-db", "Production", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "password", Map.of("secretRef", "db-pw")));

        ConfigService materializingConfig = new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                if (payload instanceof Map<?, ?> m
                        && m.containsKey("password"))
                {
                    return Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "password", "decrypted-pw");
                }
                return payload;
            }
        };

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "prod-db"), connections, registry, materializingConfig);

        assertEquals("decrypted-pw", resolved.profile()
                .properties()
                .get("password"));
    }

    @Test
    void connectionTestPayloadDefaultsUsernameAndPassword()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromPayload(Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test"), registry, NOOP_CONFIG);

        assertNotNull(resolved.profile());
        assertEquals("jdbc:h2:mem:test", resolved.profile()
                .properties()
                .get("url"));
    }

    @Test
    void rejectsWhenUrlMissingForExplicitUrlDialect()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("no-url", "Test", Map.of("dialectId", "jdbc"));

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "no-url"), connections, registry, NOOP_CONFIG));
    }

    @Test
    void engineStateResolvesConnectionIdFromFlatFormat()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("flat-conn", "Flat", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:flat"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "flat-conn"), connections, registry, NOOP_CONFIG);

        assertEquals("flat-conn", resolved.connectionId());
    }

    @Test
    void storedConnectionWithoutPasswordIsFine()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("no-pw", "No PW", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "username", "user"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "no-pw"), connections, registry, NOOP_CONFIG);

        assertEquals("no-pw", resolved.connectionId());
        assertEquals("user", resolved.profile()
                .properties()
                .get("username"));
    }

    @Test
    void fromRegistryWithOverridesWithMissingPayloadOverridesStillResolves()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("prod-db", "Production", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromRegistryWithOverrides(Map.of("connectionId", "prod-db"), connections, registry, NOOP_CONFIG);

        assertNotNull(resolved.profile());
    }

    @Test
    void dialectNotFoundThrows()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("bad-dialect", "Bad", Map.of("dialectId", "nonexistent", "url", "jdbc:h2:mem:test"));

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "bad-dialect"), connections, registry, NOOP_CONFIG));
    }

    @Test
    void connectionIdMissingInPayloads()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(Map.of(), connections, registry, NOOP_CONFIG));
        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromRegistryWithOverrides(Map.of(), connections, registry, NOOP_CONFIG));
    }

    @Test
    void dialectIdDefaultsWhenMissing()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("conn", "Connection", Map.of("url", "jdbc:h2:mem:test"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "conn"), connections, registry, NOOP_CONFIG);

        assertEquals("jdbc", resolved.profile()
                .dialectId());
    }
}
