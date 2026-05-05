package com.queryeer.backend.plugin.jdbc;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.LoggerService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.contract.settings.JdbcSettingsConnectionEntry;
import com.queryeer.backend.contract.settings.JdbcSettingsModuleDocument;
import com.queryeer.backend.contract.settings.JdbcSettingsModuleValues;

final class JdbcSettingsConnectionSource
{
    private static final String SETTINGS_DIR_KEY = "queryeer.settings.dir";
    private static final String JDBC_MODULE_ID = "core.queryengine.jdbc";
    private static final String JDBC_MODULE_FILE = "core.queryengine.jdbc.json";

    private static final String KEY_VALUES = "values";
    private static final String KEY_DIALECT_ID = "dialectId";
    private static final String KEY_URL = "url";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_PASSWORD = "password";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_SECRET_REF = "secretRef";

    private static final String DEFAULT_DIALECT_ID = "jdbc";

    private final PayloadMapper payloadMapper;
    private final ObjectMapper objectMapper = new ObjectMapper();

    JdbcSettingsConnectionSource(PayloadMapper payloadMapper)
    {
        this.payloadMapper = payloadMapper;
    }

    List<JdbcConfiguredConnection> load(ConfigService config, LoggerService logger)
    {
        SettingsModule module = config.getModule(JDBC_MODULE_ID);
        if (module != null)
        {
            return parseConnections(module.values());
        }

        // Fallback: direct file read when ConfigService doesn't support getModule()
        Path path = resolvePath(config);
        if (path == null
                || !Files.exists(path))
        {
            logger.info("JDBC settings module not found: " + JDBC_MODULE_ID);
            return List.of();
        }

        try
        {
            JdbcSettingsModuleDocument document = objectMapper.readValue(path.toFile(), JdbcSettingsModuleDocument.class);
            return parseConnections(document);
        }
        catch (IOException e)
        {
            logger.warn("Failed to read JDBC settings module file: " + path);
            logger.error("Failed to parse JDBC settings module", e);
            return List.of();
        }
    }

    List<JdbcConfiguredConnection> parseConnections(Object values)
    {
        if (values == null)
        {
            return List.of();
        }

        JdbcSettingsModuleValues moduleValues;
        if (values instanceof Map<?, ?> map)
        {
            // Accept both a full module document (with "values" key) and bare values map
            if (map.containsKey(KEY_VALUES))
            {
                moduleValues = payloadMapper.convert(values, JdbcSettingsModuleDocument.class)
                        .values();
            }
            else
            {
                moduleValues = payloadMapper.convert(values, JdbcSettingsModuleValues.class);
            }
        }
        else if (values instanceof JdbcSettingsModuleDocument document)
        {
            moduleValues = document.values();
        }
        else if (values instanceof JdbcSettingsModuleValues v)
        {
            moduleValues = v;
        }
        else
        {
            return List.of();
        }

        List<JdbcSettingsConnectionEntry> entries = moduleValues != null ? moduleValues.connections()
                : null;
        if (entries == null)
        {
            return List.of();
        }

        List<JdbcConfiguredConnection> result = new ArrayList<>();
        Set<String> seen = new java.util.LinkedHashSet<>();
        for (JdbcSettingsConnectionEntry entry : entries)
        {
            String connectionId = trimToNull(entry.connectionId());
            if (connectionId == null
                    || seen.contains(connectionId))
            {
                continue;
            }
            String dialectId = trimToNull(entry.dialectId());
            String url = trimToNull(entry.url());
            boolean hasStructuredProperties = entry.properties() != null
                    && !entry.properties()
                            .isEmpty();

            if (url == null
                    && !hasStructuredProperties)
            {
                continue;
            }
            seen.add(connectionId);

            Map<String, Object> connection = new LinkedHashMap<>();
            connection.put(KEY_DIALECT_ID, dialectId == null ? DEFAULT_DIALECT_ID
                    : dialectId);

            if (hasStructuredProperties)
            {
                connection.putAll(entry.properties());
            }
            else
            {
                connection.put(KEY_URL, url);
                String username = trimToNull(entry.username());
                if (username != null)
                {
                    connection.put(KEY_USERNAME, username);
                }
            }

            Object password = normalizePassword(entry.password());
            if (password != null)
            {
                connection.put(KEY_PASSWORD, password);
            }
            boolean enabled = entry.enabled() != null ? entry.enabled()
                    : true;
            connection.put(KEY_ENABLED, enabled);
            result.add(new JdbcConfiguredConnection(connectionId, trimToNull(entry.title()), connection));
        }
        return List.copyOf(result);
    }

    private static Path resolvePath(ConfigService config)
    {
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
            String secretRef = text(map.get(KEY_SECRET_REF));
            if (secretRef == null)
            {
                return null;
            }
            return Map.of(KEY_SECRET_REF, secretRef);
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

    record JdbcConfiguredConnection(String connectionId, String name, Map<String, Object> connection)
    {
    }
}
