package com.queryeer.backend.plugin.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.contract.jdbc.JdbcConnectionProperties;
import com.queryeer.backend.contract.jdbc.JdbcEngineState;
import com.queryeer.backend.contract.jdbc.JdbcSchemaFetchPayload;
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
        connections.upsert("prod-db", "Production", java.util.Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "username", "sa", "password", "secret"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(new JdbcEngineState("prod-db", null, null, null, null, null, null), connections, registry);

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

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(new JdbcEngineState("unknown", null, null, null, null, null, null), connections, registry));
    }

    @Test
    void fromPayloadResolvesFullConnectionForTesting()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromProperties(new JdbcConnectionProperties("jdbc", "jdbc:h2:mem:test", "sa", "secret", null, null, null, null, null), null, registry);

        assertNotNull(resolved.profile());
        assertEquals("jdbc", resolved.profile()
                .dialectId());
    }

    @Test
    void fromPayloadDefaultsDialectToJdbc()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromProperties(new JdbcConnectionProperties(null, "jdbc:h2:mem:test", null, null, null, null, null, null, null), null, registry);

        assertEquals("jdbc", resolved.profile()
                .dialectId());
    }

    @Test
    void fromRegistryWithOverridesMergesProperties()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("prod-db", "Production", java.util.Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:stored", "username", "stored-user", "password", "stored-pw"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromRegistryWithOverrides(new JdbcSchemaFetchPayload("prod-db", java.util.Map.of("schema", "override"), null, null), connections,
                registry);

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
        connections.upsert("prod-db", "Production", java.util.Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "password", java.util.Map.of("secretRef", "db-pw")));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(new JdbcEngineState("prod-db", null, null, null, null, null, null), connections, registry);

        assertEquals(java.util.Map.of("secretRef", "db-pw"), resolved.profile()
                .properties()
                .get("password"));
    }

    @Test
    void connectionTestPayloadDefaultsUsernameAndPassword()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromProperties(new JdbcConnectionProperties("jdbc", "jdbc:h2:mem:test", null, null, null, null, null, null, null), null, registry);

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
        connections.upsert("no-url", "Test", java.util.Map.of("dialectId", "jdbc"));

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(new JdbcEngineState("no-url", null, null, null, null, null, null), connections, registry));
    }

    @Test
    void engineStateResolvesConnectionIdFromFlatFormat()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("flat-conn", "Flat", java.util.Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:flat"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(new JdbcEngineState("flat-conn", null, null, null, null, null, null), connections, registry);

        assertEquals("flat-conn", resolved.connectionId());
    }

    @Test
    void storedConnectionWithoutPasswordIsFine()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("no-pw", "No PW", java.util.Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test", "username", "user"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(new JdbcEngineState("no-pw", null, null, null, null, null, null), connections, registry);

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
        connections.upsert("prod-db", "Production", java.util.Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromRegistryWithOverrides(new JdbcSchemaFetchPayload("prod-db", null, null, null), connections, registry);

        assertNotNull(resolved.profile());
    }

    @Test
    void dialectNotFoundThrows()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("bad-dialect", "Bad", java.util.Map.of("dialectId", "nonexistent", "url", "jdbc:h2:mem:test"));

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(new JdbcEngineState("bad-dialect", null, null, null, null, null, null), connections, registry));
    }

    @Test
    void connectionIdMissingInPayloads()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();

        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromEngineState(new JdbcEngineState(null, null, null, null, null, null, null), connections, registry));
        assertThrows(IllegalArgumentException.class, () -> JdbcResolvedConnection.fromRegistryWithOverrides(new JdbcSchemaFetchPayload(null, null, null, null), connections, registry));
    }

    @Test
    void dialectIdDefaultsWhenMissing()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        JdbcConnectionRegistry connections = new JdbcConnectionRegistry();
        connections.upsert("conn", "Connection", java.util.Map.of("url", "jdbc:h2:mem:test"));

        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(new JdbcEngineState("conn", null, null, null, null, null, null), connections, registry);

        assertEquals("jdbc", resolved.profile()
                .dialectId());
    }
}
