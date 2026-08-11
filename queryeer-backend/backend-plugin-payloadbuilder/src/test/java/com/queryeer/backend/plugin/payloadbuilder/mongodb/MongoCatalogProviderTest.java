package com.queryeer.backend.plugin.payloadbuilder.mongodb;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.core.JacksonPayloadMapper;

import se.kuseman.payloadbuilder.catalog.mongodb.MongoCatalog;
import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

class MongoCatalogProviderTest
{
    private static final PayloadMapper TEST_MAPPER = new JacksonPayloadMapper();

    @Test
    void injectPropertiesResolvesEnabledConnectionAndMaterializesPassword()
    {
        Map<String, Object> connection = Map.of("connectionId", "mongo-1", "connectionString", "mongodb://localhost:27017", "authUsername", "queryeer", "authPassword",
                Map.of("secretRef", "mongo-password"), "authDatabase", "admin", "enabled", true);
        MongoCatalogProvider provider = new MongoCatalogProvider(config(List.of(connection)), TEST_MAPPER);
        QuerySession session = new QuerySession(new CatalogRegistry());

        provider.injectProperties(session, "mongo", Map.of("connectionId", "mongo-1"));

        assertEquals("mongodb://localhost:27017", property(session, MongoCatalog.CONNECTIONSTRING_KEY));
        assertEquals("queryeer", property(session, MongoCatalog.AUTH_USERNAME_KEY));
        assertEquals("mongo-password", property(session, MongoCatalog.AUTH_PASSWORD_KEY));
        assertEquals("admin", property(session, MongoCatalog.AUTH_DATABASE_KEY));
    }

    @Test
    void injectPropertiesClearsPreviousConnectionWhenSelectionIsMissing()
    {
        MongoCatalogProvider provider = new MongoCatalogProvider(config(List.of()), TEST_MAPPER);
        QuerySession session = new QuerySession(new CatalogRegistry());
        session.setCatalogProperty("mongo", MongoCatalog.CONNECTIONSTRING_KEY, "mongodb://old:27017");
        session.setCatalogProperty("mongo", MongoCatalog.AUTH_USERNAME_KEY, "old-user");

        assertDoesNotThrow(() -> provider.injectProperties(session, "mongo", Map.of("connectionId", "missing")));

        assertNull(property(session, MongoCatalog.CONNECTIONSTRING_KEY));
        assertNull(property(session, MongoCatalog.AUTH_USERNAME_KEY));
    }

    @Test
    void injectPropertiesReplacesEveryNativePropertyWhenConnectionChanges()
    {
        Map<String, Object> first = Map.of("connectionId", "mongo-1", "connectionString", "mongodb://first:27017", "authUsername", "first-user", "authPassword", "first-password", "authDatabase",
                "first-auth", "enabled", true);
        Map<String, Object> second = Map.of("connectionId", "mongo-2", "connectionString", "mongodb://second:27017", "authUsername", "second-user", "authPassword", "second-password", "authDatabase",
                "second-auth", "enabled", true);
        MongoCatalogProvider provider = new MongoCatalogProvider(config(List.of(first, second)), TEST_MAPPER);
        QuerySession session = new QuerySession(new CatalogRegistry());

        provider.injectProperties(session, "mongo", Map.of("connectionId", "mongo-1"));
        provider.injectProperties(session, "mongo", Map.of("connectionId", "mongo-2"));

        assertEquals("mongodb://second:27017", property(session, MongoCatalog.CONNECTIONSTRING_KEY));
        assertEquals("second-user", property(session, MongoCatalog.AUTH_USERNAME_KEY));
        assertEquals("second-password", property(session, MongoCatalog.AUTH_PASSWORD_KEY));
        assertEquals("second-auth", property(session, MongoCatalog.AUTH_DATABASE_KEY));
    }

    private static ConfigService config(List<Map<String, Object>> connections)
    {
        SettingsModule module = new SettingsModule("core.queryengine.payloadbuilder.mongodb", 1L, "2026-01-01T00:00:00Z", Map.of("core.queryengine.payloadbuilder.mongodb.connections", connections));
        return new ConfigService()
        {
            @Override
            public String get(String key)
            {
                return null;
            }

            @Override
            public SettingsModule getModule(String moduleId)
            {
                return "core.queryengine.payloadbuilder.mongodb".equals(moduleId) ? module
                        : null;
            }

            @Override
            public Object materializeSecrets(Object payload)
            {
                if (payload instanceof Map<?, ?> map
                        && map.size() == 1
                        && map.containsKey("secretRef"))
                {
                    return map.get("secretRef");
                }
                return payload;
            }
        };
    }

    private static String property(QuerySession session, String key)
    {
        var value = session.getCatalogProperty("mongo", key);
        return value == null
                || value.size() == 0
                || value.isNull(0) ? null
                        : value.valueAsString(0);
    }
}
