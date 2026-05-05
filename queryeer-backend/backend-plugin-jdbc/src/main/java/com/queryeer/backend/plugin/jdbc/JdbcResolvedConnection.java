package com.queryeer.backend.plugin.jdbc;

import java.util.LinkedHashMap;
import java.util.Map;

import com.queryeer.backend.contract.jdbc.JdbcConnectionProperties;
import com.queryeer.backend.contract.jdbc.JdbcEngineState;
import com.queryeer.backend.contract.jdbc.JdbcSchemaFetchPayload;
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

    private static final String KEY_CONNECTION_ID = "connectionId";
    private static final String KEY_DIALECT_ID = "dialectId";
    private static final String KEY_URL = "url";
    private static final String KEY_HOST = "host";
    private static final String KEY_PROPERTIES = "properties";
    private static final String KEY_USERNAME = "username";
    private static final String KEY_PASSWORD = "password";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_PORT = "port";
    private static final String KEY_DATABASE = "database";

    private static final String ERROR_UNKNOWN_CONNECTION_ID = "Unknown connectionId: ";
    private static final String ERROR_UNSUPPORTED_DIALECT = "Unsupported JDBC dialect: ";
    private static final String ERROR_NO_URL = "Connection has no url configured: ";
    private static final String ERROR_NO_PROPERTIES = "Connection has no properties configured: ";
    private static final String ERROR_CONNECTION_ID_REQUIRED = "connectionId is required";

    /**
     * Resolves from an engineState. Supports {@code { "connectionId": "..." }} (new format) and inline connection properties (legacy test format with url/dialectId).
     */
    static JdbcResolvedConnection fromEngineState(JdbcEngineState state, JdbcConnectionRegistry connections, JdbcDialectRegistry registry)
    {
        String connectionId = trimToNull(state.connectionId());
        if (connectionId != null)
        {
            JdbcConnectionRegistry.JdbcStoredConnection stored = connections.get(connectionId)
                    .orElseThrow(() -> new IllegalArgumentException(ERROR_UNKNOWN_CONNECTION_ID + connectionId));
            return fromStoredConnection(stored, registry, Map.of());
        }

        // Fallback: inline connection properties (from tests using legacy format)
        Map<String, Object> effective = toMap(state);
        if (state.jdbc() != null
                && state.jdbc()
                        .connection() != null)
        {
            effective = state.jdbc()
                    .connection();
        }
        if (effective.containsKey(KEY_URL)
                || effective.containsKey(KEY_DIALECT_ID)
                || effective.containsKey(KEY_PROPERTIES))
        {
            return fromProperties(effective, null, registry);
        }

        throw new IllegalArgumentException(ERROR_CONNECTION_ID_REQUIRED);
    }

    /** Resolves from typed connection properties (used by connectionTest). */
    static JdbcResolvedConnection fromProperties(JdbcConnectionProperties props, String connectionId, JdbcDialectRegistry registry)
    {
        return fromProperties(toMap(props), connectionId, registry);
    }

    /** Resolves from a payload with connectionId + optional property overrides (used by schemaFetch). */
    static JdbcResolvedConnection fromRegistryWithOverrides(JdbcSchemaFetchPayload payload, JdbcConnectionRegistry connections, JdbcDialectRegistry registry)
    {
        String connectionId = trimToNull(payload.connectionId());
        if (connectionId == null)
        {
            throw new IllegalArgumentException(ERROR_CONNECTION_ID_REQUIRED);
        }

        JdbcConnectionRegistry.JdbcStoredConnection stored = connections.get(connectionId)
                .orElseThrow(() -> new IllegalArgumentException(ERROR_UNKNOWN_CONNECTION_ID + connectionId));

        Map<String, Object> overrides = payload.properties() != null ? payload.properties()
                : Map.of();
        return fromStoredConnection(stored, registry, overrides);
    }

    private static JdbcResolvedConnection fromStoredConnection(JdbcConnectionRegistry.JdbcStoredConnection stored, JdbcDialectRegistry registry, Map<String, Object> overrides)
    {
        String dialectId = stringValue(stored.connection()
                .get(KEY_DIALECT_ID));
        JdbcDialect dialect = registry.find(dialectId != null ? dialectId
                : ENGINE_ID)
                .orElseThrow(() -> new IllegalArgumentException(ERROR_UNSUPPORTED_DIALECT + (dialectId != null ? dialectId
                        : ENGINE_ID)));

        Map<String, Object> merged = mergeProperties(stored.connection(), overrides);
        validateConnection(dialect, merged, stored.connectionId());

        return new JdbcResolvedConnection(stored.connectionId(), dialect, new JdbcConnectionProfile(stored.connectionId(), stored.name(), dialect.metadata()
                .id(), merged));
    }

    private static JdbcResolvedConnection fromProperties(Map<String, Object> properties, String connectionId, JdbcDialectRegistry registry)
    {
        String dialectId = stringValue(properties.get(KEY_DIALECT_ID));
        JdbcDialect dialect = registry.find(dialectId != null ? dialectId
                : ENGINE_ID)
                .orElseThrow(() -> new IllegalArgumentException(ERROR_UNSUPPORTED_DIALECT + (dialectId != null ? dialectId
                        : ENGINE_ID)));

        validateConnection(dialect, properties, connectionId);

        return new JdbcResolvedConnection(connectionId, dialect, new JdbcConnectionProfile(connectionId, null, dialect.metadata()
                .id(), properties));
    }

    private static void validateConnection(JdbcDialect dialect, Map<String, Object> properties, String connectionId)
    {
        if (dialect.requiresExplicitUrl())
        {
            String url = stringValue(properties.get(KEY_URL));
            if (url == null)
            {
                throw new IllegalArgumentException(ERROR_NO_URL + connectionId);
            }
        }
        else if (!properties.containsKey(KEY_HOST)
                && !properties.containsKey(KEY_URL))
        {
            throw new IllegalArgumentException(ERROR_NO_PROPERTIES + connectionId);
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

    private static Map<String, Object> toMap(JdbcConnectionProperties props)
    {
        Map<String, Object> map = new LinkedHashMap<>();
        if (props.dialectId() != null)
        {
            map.put(KEY_DIALECT_ID, props.dialectId());
        }
        if (props.url() != null)
        {
            map.put(KEY_URL, props.url());
        }
        if (props.username() != null)
        {
            map.put(KEY_USERNAME, props.username());
        }
        if (props.password() != null)
        {
            map.put(KEY_PASSWORD, props.password());
        }
        if (props.host() != null)
        {
            map.put(KEY_HOST, props.host());
        }
        if (props.port() != null)
        {
            map.put(KEY_PORT, props.port());
        }
        if (props.database() != null)
        {
            map.put(KEY_DATABASE, props.database());
        }
        if (props.properties() != null)
        {
            map.putAll(props.properties());
        }
        if (props.enabled() != null)
        {
            map.put(KEY_ENABLED, props.enabled());
        }
        return map;
    }

    private static Map<String, Object> toMap(JdbcEngineState state)
    {
        Map<String, Object> map = new LinkedHashMap<>();
        if (state.dialectId() != null)
        {
            map.put(KEY_DIALECT_ID, state.dialectId());
        }
        if (state.url() != null)
        {
            map.put(KEY_URL, state.url());
        }
        if (state.properties() != null)
        {
            map.putAll(state.properties());
        }
        return map;
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
}
