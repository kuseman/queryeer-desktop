package com.queryeer.backend.plugin.jdbc;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.LoggerService;

final class JdbcSettingsConnectionSource
{
    private static final String SETTINGS_PATH_KEY = "queryeer.settings.path";
    private static final String SETTINGS_DIR_KEY = "queryeer.settings.dir";
    private static final String JDBC_MODULE_FILE = "core.queryengine.jdbc.json";
    private static final String JDBC_CONNECTIONS_SETTING_ID = "core.queryengine.jdbc.connections";

    private final ObjectMapper objectMapper = new ObjectMapper();

    List<JdbcConfiguredConnection> load(ConfigService config, LoggerService logger)
    {
        Path settingsPath = resolvePath(config);
        if (settingsPath == null)
        {
            return List.of();
        }
        if (!Files.exists(settingsPath))
        {
            logger.info("JDBC settings module file not found: " + settingsPath);
            return List.of();
        }

        try
        {
            Map<String, Object> module = objectMapper.readValue(settingsPath.toFile(), new TypeReference<Map<String, Object>>()
            {
            });
            return parseConnections(module);
        }
        catch (IOException e)
        {
            logger.warn("Failed to read JDBC settings module file: " + settingsPath);
            logger.error("Failed to parse JDBC settings module", e);
            return List.of();
        }
    }

    List<JdbcConfiguredConnection> parseConnections(Map<String, Object> moduleDocument)
    {
        if (moduleDocument == null)
        {
            return List.of();
        }
        Object valuesRaw = moduleDocument.get("values");
        if (!(valuesRaw instanceof Map<?, ?> values))
        {
            return List.of();
        }
        Object listRaw = values.get(JDBC_CONNECTIONS_SETTING_ID);
        if (!(listRaw instanceof List<?> list))
        {
            return List.of();
        }

        List<JdbcConfiguredConnection> result = new ArrayList<>();
        Set<String> seen = new java.util.LinkedHashSet<>();
        for (Object item : list)
        {
            if (!(item instanceof Map<?, ?> map))
            {
                continue;
            }
            String connectionId = text(map.get("connectionId"));
            String url = text(map.get("url"));
            if (connectionId == null
                    || url == null
                    || seen.contains(connectionId))
            {
                continue;
            }
            seen.add(connectionId);
            String dialectId = text(map.get("dialectId"));
            String username = text(map.get("username"));
            Map<String, Object> connection = new LinkedHashMap<>();
            connection.put("dialectId", dialectId == null ? "jdbc"
                    : dialectId);
            connection.put("url", url);
            if (username != null)
            {
                connection.put("username", username);
            }
            Object password = normalizePassword(map.get("password"));
            if (password != null)
            {
                connection.put("password", password);
            }
            boolean enabled = boolOrDefault(map.get("enabled"), true);
            connection.put("enabled", enabled);
            result.add(new JdbcConfiguredConnection(connectionId, text(map.get("title")), connection));
        }
        return List.copyOf(result);
    }

    private static Path resolvePath(ConfigService config)
    {
        String explicitPath = trimToNull(config.get(SETTINGS_PATH_KEY));
        if (explicitPath != null)
        {
            return Path.of(explicitPath);
        }
        String settingsDir = trimToNull(config.get(SETTINGS_DIR_KEY));
        if (settingsDir == null)
        {
            return null;
        }
        return Path.of(settingsDir, JDBC_MODULE_FILE);
    }

    private static Object normalizePassword(Object raw)
    {
        if (raw instanceof Map<?, ?> map)
        {
            String secretRef = text(map.get("secretRef"));
            if (secretRef == null)
            {
                return null;
            }
            return Map.of("secretRef", secretRef);
        }
        return text(raw);
    }

    private static String text(Object value)
    {
        if (value instanceof String string)
        {
            return trimToNull(string);
        }
        return null;
    }

    private static String trimToNull(String value)
    {
        if (value == null)
        {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isBlank() ? null
                : trimmed;
    }

    private static boolean boolOrDefault(Object value, boolean defaultValue)
    {
        if (value instanceof Boolean bool)
        {
            return bool;
        }
        return defaultValue;
    }

    record JdbcConfiguredConnection(String connectionId, String name, Map<String, Object> connection)
    {
    }
}
