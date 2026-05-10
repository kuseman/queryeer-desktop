package com.queryeer.backend.plugin.jdbc;

import static com.queryeer.backend.plugin.jdbc.TestUtils.mockConnections;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.queryengine.jdbc.DefaultJdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

class DefaultJdbcConnectionsTest
{
    private static final PayloadMapper PAYLOAD_MAPPER = TestPayloadMapper.INSTANCE;

    @Test
    void resolveInvalidInput()
    {
        assertThrows(IllegalArgumentException.class, () -> new DefaultJdbcConnections(_ -> null, PAYLOAD_MAPPER, new DefaultJdbcDialectRegistry()).resolve(null));
    }

    @Test
    void resolveUnknownConnectionThrows()
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        DefaultJdbcConnections connections = new DefaultJdbcConnections(_ -> null, PAYLOAD_MAPPER, registry);

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> connections.resolve("missing"));
        assertEquals("Unknown connectionId: missing", error.getMessage());
    }

    @Test
    void resolveRejectsUnknownDialect() throws Exception
    {
        ConfigService configService = mockConnections("""
                {
                    "core.queryengine.jdbc.connections": [
                        {
                            "connectionId": "bad",
                            "dialectId": "oracle",
                            "url": "ora://",
                            "enabled": true
                        }
                    ]
                }
                """);

        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        DefaultJdbcConnections connections = new DefaultJdbcConnections(configService, PAYLOAD_MAPPER, registry);

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class, () -> connections.resolve("bad"));
        assertEquals("Unsupported JDBC dialect: oracle", error.getMessage());
    }

    @Test
    void resolveMaterializesSecretRefs() throws Exception
    {
        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());

        ConfigService configService = mockConnections("""
                {
                    "core.queryengine.jdbc.connections": [
                        {
                            "connectionId": "sec",
                            "dialectId": "jdbc",
                            "enabled": true,
                            "password": {
                                "secretRef": "db-pass"
                            },
                            "url": "jdbc://"
                        }
                    ]
                }
                """);

        DefaultJdbcConnections connections = new DefaultJdbcConnections(configService, PAYLOAD_MAPPER, registry);

        JdbcConnection resolved = connections.resolve("sec");

        assertEquals("jdbc://", resolved.properties()
                .get("url"));
        assertEquals("materialized-db-pass", resolved.properties()
                .get("password"));

    }

    @Test
    void loadsConfiguredConnectionsFromSettingsModuleFixture(@TempDir Path tempDir) throws IOException
    {
        Path settingsDir = tempDir.resolve("settings");
        Files.createDirectories(settingsDir);
        Path fixturePath = Path.of("..", "..", "protocol-fixtures", "jdbc", "connection-settings.json")
                .normalize();
        Files.copy(fixturePath, settingsDir.resolve("core.queryengine.jdbc.json"), StandardCopyOption.REPLACE_EXISTING);

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
                if (!"core.queryengine.jdbc".equals(moduleId))
                {
                    return null;
                }
                try
                {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> module = new com.fasterxml.jackson.databind.ObjectMapper().readValue(settingsDir.resolve("core.queryengine.jdbc.json")
                            .toFile(), Map.class);
                    long version = ((Number) module.getOrDefault("version", 1)).longValue();
                    String updatedAt = String.valueOf(module.getOrDefault("updatedAt", ""));
                    @SuppressWarnings("unchecked")
                    Map<String, Object> values = module.get("values") instanceof Map<?, ?> map ? (Map<String, Object>) map
                            : Map.of();
                    return new SettingsModule(moduleId, version, updatedAt, values);
                }
                catch (IOException e)
                {
                    throw new RuntimeException(e);
                }
            }
        };

        JdbcDialectRegistry registry = new DefaultJdbcDialectRegistry();
        registry.register(new BasicJdbcDialect());
        DefaultJdbcConnections connections = new DefaultJdbcConnections(config, PAYLOAD_MAPPER, registry);

        List<String> all = connections.allConfiguredConnectionIds();
        assertEquals(Set.of("550e8400-e29b-41d4-a716-446655440003", "550e8400-e29b-41d4-a716-446655440002", "550e8400-e29b-41d4-a716-446655440001"), new HashSet<>(all));

        JdbcConnection resolved = connections.resolve("550e8400-e29b-41d4-a716-446655440003");
        assertNotNull(resolved);
        assertFalse(resolved.properties()
                .isEmpty());
    }
}
