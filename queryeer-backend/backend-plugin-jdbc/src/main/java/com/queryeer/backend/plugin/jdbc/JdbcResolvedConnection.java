package com.queryeer.backend.plugin.jdbc;

import java.util.LinkedHashMap;
import java.util.Map;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;

/**
 * Fully resolved JDBC connection ready for query execution, schema fetching, or connection testing. Extracted from {@link JdbcQueryEngineProvider} to centralize connection resolution, credential
 * materialization, and profile construction.
 */
record JdbcResolvedConnection(String connectionId, JdbcDialect dialect, JdbcConnectionProfile profile)
{

    private static final String ENGINE_ID = "jdbc";

    /**
     * Resolves from an engineState. Supports {@code { "connectionId": "..." }} (new format) and inline connection properties (legacy test format with url/dialectId).
     */
    static JdbcResolvedConnection fromEngineState(Object engineState, JdbcConnectionRegistry connections, JdbcDialectRegistry registry, ConfigService configService)
    {
        Map<String, Object> map = asMap(engineState);
        String connectionId = stringValue(map.get("connectionId"));
        if (connectionId != null)
        {
            JdbcConnectionRegistry.JdbcStoredConnection stored = connections.get(connectionId)
                    .orElseThrow(() -> new IllegalArgumentException("Unknown connectionId: " + connectionId));
            return fromStoredConnection(stored, registry, configService, Map.of());
        }

        // Fallback: inline connection properties (from tests using legacy format)
        Map<String, Object> effective = map;
        if (map.get("jdbc") instanceof Map<?, ?> jdbcMap
                && jdbcMap.get("connection") instanceof Map<?, ?> connMap)
        {
            @SuppressWarnings("unchecked")
            Map<String, Object> inner = (Map<String, Object>) connMap;
            effective = inner;
        }
        if (effective.containsKey("url")
                || effective.containsKey("dialectId")
                || effective.containsKey("properties"))
        {
            return fromProperties(effective, null, registry, configService);
        }

        throw new IllegalArgumentException("connectionId is required");
    }

    /** Resolves from a raw payload containing full connection properties (used by connectionTest). */
    static JdbcResolvedConnection fromPayload(Object payload, JdbcDialectRegistry registry, ConfigService configService)
    {
        return fromProperties(asMap(payload), null, registry, configService);
    }

    /** Resolves from a payload with connectionId + optional property overrides (used by schemaFetch). */
    static JdbcResolvedConnection fromRegistryWithOverrides(Object payload, JdbcConnectionRegistry connections, JdbcDialectRegistry registry, ConfigService configService)
    {
        Map<String, Object> value = asMap(payload);
        String connectionId = stringValue(value.get("connectionId"));
        if (connectionId == null)
        {
            throw new IllegalArgumentException("connectionId is required");
        }

        JdbcConnectionRegistry.JdbcStoredConnection stored = connections.get(connectionId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown connectionId: " + connectionId));

        @SuppressWarnings("unchecked")
        Map<String, Object> overrides = value.get("properties") instanceof Map<?, ?> p ? (Map<String, Object>) p
                : Map.of();
        return fromStoredConnection(stored, registry, configService, overrides);
    }

    private static JdbcResolvedConnection fromStoredConnection(JdbcConnectionRegistry.JdbcStoredConnection stored, JdbcDialectRegistry registry, ConfigService configService,
            Map<String, Object> overrides)
    {
        String dialectId = stringValue(stored.connection()
                .get("dialectId"));
        JdbcDialect dialect = registry.find(dialectId != null ? dialectId
                : ENGINE_ID)
                .orElseThrow(() -> new IllegalArgumentException("Unsupported JDBC dialect: " + (dialectId != null ? dialectId
                        : ENGINE_ID)));

        Map<String, Object> resolved = materialize(mergeProperties(stored.connection(), overrides), configService);
        validateConnection(dialect, resolved, stored.connectionId());

        return new JdbcResolvedConnection(stored.connectionId(), dialect, new JdbcConnectionProfile(stored.connectionId(), stored.name(), dialect.metadata()
                .id(), resolved));
    }

    private static JdbcResolvedConnection fromProperties(Map<String, Object> properties, String connectionId, JdbcDialectRegistry registry, ConfigService configService)
    {
        String dialectId = stringValue(properties.get("dialectId"));
        JdbcDialect dialect = registry.find(dialectId != null ? dialectId
                : ENGINE_ID)
                .orElseThrow(() -> new IllegalArgumentException("Unsupported JDBC dialect: " + (dialectId != null ? dialectId
                        : ENGINE_ID)));

        Map<String, Object> resolved = materialize(properties, configService);
        validateConnection(dialect, resolved, connectionId);

        return new JdbcResolvedConnection(connectionId, dialect, new JdbcConnectionProfile(connectionId, null, dialect.metadata()
                .id(), resolved));
    }

    private static void validateConnection(JdbcDialect dialect, Map<String, Object> properties, String connectionId)
    {
        if (dialect.requiresExplicitUrl())
        {
            String url = stringValue(properties.get("url"));
            if (url == null)
            {
                throw new IllegalArgumentException("Connection has no url configured: " + connectionId);
            }
        }
        else if (!properties.containsKey("host")
                && !properties.containsKey("url"))
        {
            throw new IllegalArgumentException("Connection has no properties configured: " + connectionId);
        }
    }

    private static Map<String, Object> mergeProperties(Map<String, Object> stored, Map<String, Object> overrides)
    {
        if (overrides.isEmpty())
        {
            return stored;
        }
        Map<String, Object> merged = new LinkedHashMap<>(stored);
        merged.putAll(overrides);
        return merged;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> materialize(Map<String, Object> properties, ConfigService configService)
    {
        Object resolved = configService.materializeSecrets(properties);
        if (resolved instanceof Map<?, ?> resolvedMap)
        {
            return (Map<String, Object>) resolvedMap;
        }
        return properties;
    }

    private static Map<String, Object> asMap(Object value)
    {
        if (value instanceof Map<?, ?> map)
        {
            @SuppressWarnings("unchecked")
            Map<String, Object> result = (Map<String, Object>) map;
            return result;
        }
        return Map.of();
    }

    private static String stringValue(Object value)
    {
        if (value instanceof String s)
        {
            String trimmed = s.trim();
            return trimmed.isEmpty() ? null
                    : trimmed;
        }
        return null;
    }
}
