package com.queryeer.backend.plugin.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.SettingsModule;

class JdbcConnectionRegistryTest
{
    private static final ConfigService CONFIG_WITH_CONNECTION = new ConfigService()
    {
        @Override
        public String get(String key)
        {
            return "queryeer.settings.dir".equals(key) ? "/tmp/settings"
                    : null;
        }

        @Override
        public SettingsModule getModule(String moduleId)
        {
            if (!"core.queryengine.jdbc".equals(moduleId))
            {
                return null;
            }
            return new SettingsModule(moduleId, 1L, "now",
                    Map.of("core.queryengine.jdbc.connections",
                            List.of(Map.of("connectionId", "configured-1", "title", "Configured One", "dialectId", "jdbc", "url", "jdbc:h2:mem:one", "enabled", true),
                                    Map.of("connectionId", "configured-2", "title", "Configured Two", "dialectId", "jdbc", "url", "jdbc:h2:mem:two", "enabled", true))));
        }
    };

    private static final LoggerService SILENT_LOGGER = new LoggerService()
    {
        @Override
        public void info(String message)
        {
        }

        @Override
        public void warn(String message)
        {
        }

        @Override
        public void error(String message, Throwable throwable)
        {
        }
    };

    @Test
    void getReturnsAdHocConnection()
    {
        JdbcConnectionRegistry registry = new JdbcConnectionRegistry(CONFIG_WITH_CONNECTION, new JdbcSettingsConnectionSource(), SILENT_LOGGER);
        registry.upsert("adhoc-1", "AdHoc", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:adhoc"));

        Optional<JdbcConnectionRegistry.JdbcStoredConnection> result = registry.get("adhoc-1");

        assertTrue(result.isPresent());
        assertEquals("adhoc-1", result.get()
                .connectionId());
        assertEquals("AdHoc", result.get()
                .name());
    }

    @Test
    void getFallsBackToConfiguredConnection()
    {
        JdbcConnectionRegistry registry = new JdbcConnectionRegistry(CONFIG_WITH_CONNECTION, new JdbcSettingsConnectionSource(), SILENT_LOGGER);

        Optional<JdbcConnectionRegistry.JdbcStoredConnection> result = registry.get("configured-1");

        assertTrue(result.isPresent());
        assertEquals("configured-1", result.get()
                .connectionId());
        assertEquals("Configured One", result.get()
                .name());
    }

    @Test
    void getReturnsEmptyForUnknownConnection()
    {
        JdbcConnectionRegistry registry = new JdbcConnectionRegistry(CONFIG_WITH_CONNECTION, new JdbcSettingsConnectionSource(), SILENT_LOGGER);

        Optional<JdbcConnectionRegistry.JdbcStoredConnection> result = registry.get("unknown");

        assertFalse(result.isPresent());
    }

    @Test
    void allMergesAdHocAndConfigured()
    {
        JdbcConnectionRegistry registry = new JdbcConnectionRegistry(CONFIG_WITH_CONNECTION, new JdbcSettingsConnectionSource(), SILENT_LOGGER);
        registry.upsert("adhoc-1", "AdHoc", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:adhoc"));

        List<JdbcConnectionRegistry.JdbcStoredConnection> result = registry.all();

        assertEquals(3, result.size());
        List<String> ids = result.stream()
                .map(JdbcConnectionRegistry.JdbcStoredConnection::connectionId)
                .toList();
        assertTrue(ids.contains("configured-1"));
        assertTrue(ids.contains("configured-2"));
        assertTrue(ids.contains("adhoc-1"));
    }

    @Test
    void adHocOverridesConfigured()
    {
        JdbcConnectionRegistry registry = new JdbcConnectionRegistry(CONFIG_WITH_CONNECTION, new JdbcSettingsConnectionSource(), SILENT_LOGGER);
        registry.upsert("configured-1", "Overridden", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:override"));

        Optional<JdbcConnectionRegistry.JdbcStoredConnection> result = registry.get("configured-1");

        assertTrue(result.isPresent());
        assertEquals("Overridden", result.get()
                .name());
        assertEquals("jdbc:h2:mem:override", result.get()
                .connection()
                .get("url"));
    }

    @Test
    void noArgConstructorWorksForTests()
    {
        JdbcConnectionRegistry registry = new JdbcConnectionRegistry();
        registry.upsert("test", "Test", Map.of("dialectId", "jdbc", "url", "jdbc:h2:mem:test"));

        Optional<JdbcConnectionRegistry.JdbcStoredConnection> result = registry.get("test");

        assertTrue(result.isPresent());
        assertEquals("test", result.get()
                .connectionId());
    }
}
