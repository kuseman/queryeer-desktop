package com.queryeer.backend.plugin.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.queryengine.jdbc.DefaultJdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

class JdbcResolvedConnectionTest
{
    @Test
    void fromEngineStateResolvesConnectionFromRegistry()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("prod-db", "Production", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "username", "sa", "password", "secret"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "prod-db"), connections, registry);

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

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "unknown"), connections, registry));
    }

    @Test
    void fromPayloadResolvesFullConnectionForTesting()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromPayload(Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "username", "sa", "password", "secret"), registry);

        assertNotNull(resolved.profile());
        assertEquals("jdbc", resolved.profile()
                .dialectId());
    }

    @Test
    void fromPayloadDefaultsDialectToJdbc()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromPayload(Map.of("url", "jdbc:h2:mem:test"), registry);

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

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromRegistryWithOverrides(Map.of("connectionId", "prod-db", "properties", Map.of("schema", "override")), connections, registry);

        assertEquals("prod-db", resolved.connectionId());
        assertEquals("override", resolved.profile()
                .properties()
                .get("schema"));
        assertEquals("jdbc:h2:mem:stored", resolved.profile()
                .properties()
                .get("url"));
    }

    @Test
    void preservesSecretRefWrappers()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("prod-db", "Production", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "password", Map.of("secretRef", "db-pw")));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "prod-db"), connections, registry);

        assertEquals(Map.of("secretRef", "db-pw"), resolved.profile()
                .properties()
                .get("password"));
    }

    @Test
    void connectionTestPayloadDefaultsUsernameAndPassword()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromPayload(Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test"), registry);

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

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "no-url"), connections, registry));
    }

    @Test
    void engineStateResolvesConnectionIdFromFlatFormat()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("flat-conn", "Flat", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:flat"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "flat-conn"), connections, registry);

        assertEquals("flat-conn", resolved.connectionId());
    }

    @Test
    void storedConnectionWithoutPasswordIsFine()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("no-pw", "No PW", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "username", "user"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "no-pw"), connections, registry);

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

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromRegistryWithOverrides(Map.of("connectionId", "prod-db"), connections, registry);

        assertNotNull(resolved.profile());
    }

    @Test
    void dialectNotFoundThrows()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("bad-dialect", "Bad", Map.of("dialectId", "nonexistent", "url", "jdbc:h2:mem:test"));

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "bad-dialect"), connections, registry));
    }

    @Test
    void connectionIdMissingInPayloads()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(Map.of(), connections, registry));
        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromRegistryWithOverrides(Map.of(), connections, registry));
    }

    @Test
    void dialectIdDefaultsWhenMissing()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("conn", "Connection", Map.of("url", "jdbc:h2:mem:test"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(Map.of("connectionId", "conn"), connections, registry);

        assertEquals("jdbc", resolved.profile()
                .dialectId());
    }
}
