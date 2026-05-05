package com.queryeer.backend.plugin.jdbc;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.PayloadMapper;

class JdbcSettingsConnectionSourceTest
{
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final PayloadMapper payloadMapper = new PayloadMapper()
    {
        @Override
        public <T> T convert(Object fromValue, Class<T> toValueType)
        {
            return objectMapper.convertValue(fromValue, toValueType);
        }
    };

    @Test
    void parsesSharedJdbcFixture() throws IOException
    {
        Path fixturePath = Path.of("..", "..", "protocol-fixtures", "jdbc", "connection-settings.json")
                .normalize();
        @SuppressWarnings("unchecked")
        Map<String, Object> moduleDocument = objectMapper.readValue(fixturePath.toFile(), Map.class);

        JdbcSettingsConnectionSource source = new JdbcSettingsConnectionSource(payloadMapper);

        List<JdbcSettingsConnectionSource.JdbcConfiguredConnection> connections = source.parseConnections(moduleDocument);

        Assertions.assertEquals(4, connections.size());
        Assertions.assertEquals("550e8400-e29b-41d4-a716-446655440001", connections.get(0)
                .connectionId());
        Assertions.assertEquals("postgres", connections.get(0)
                .connection()
                .get("dialectId"));
        Assertions.assertEquals(Map.of("secretRef", "sec-1"), connections.get(0)
                .connection()
                .get("password"));
        Assertions.assertEquals("550e8400-e29b-41d4-a716-446655440002", connections.get(1)
                .connectionId());
        Assertions.assertEquals("jdbc:first", connections.get(1)
                .connection()
                .get("url"));
        Assertions.assertEquals("550e8400-e29b-41d4-a716-446655440003", connections.get(2)
                .connectionId());
        Assertions.assertEquals("jdbc", connections.get(2)
                .connection()
                .get("dialectId"));
        Assertions.assertEquals("550e8400-e29b-41d4-a716-446655440004", connections.get(3)
                .connectionId());
        Assertions.assertEquals(Boolean.FALSE, connections.get(3)
                .connection()
                .get("enabled"));
    }

    @Test
    void loadsFromSettingsDirConfig(@TempDir Path tempDir) throws IOException
    {
        Path settingsDir = tempDir.resolve("settings");
        Files.createDirectories(settingsDir);
        Path fixturePath = Path.of("..", "..", "protocol-fixtures", "jdbc", "connection-settings.json")
                .normalize();
        Files.copy(fixturePath, settingsDir.resolve("core.queryengine.jdbc.json"), StandardCopyOption.REPLACE_EXISTING);

        JdbcSettingsConnectionSource source = new JdbcSettingsConnectionSource(payloadMapper);
        List<JdbcSettingsConnectionSource.JdbcConfiguredConnection> connections = source.load(key -> "queryeer.settings.dir".equals(key) ? settingsDir.toString()
                : null, new NoopLoggerService());

        Assertions.assertEquals(4, connections.size());
    }

    private static final class NoopLoggerService implements LoggerService
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
        public void error(String message, Throwable error)
        {
        }
    }
}
