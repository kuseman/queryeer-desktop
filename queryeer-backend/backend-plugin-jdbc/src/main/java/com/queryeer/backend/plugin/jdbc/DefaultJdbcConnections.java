package com.queryeer.backend.plugin.jdbc;

import static com.queryeer.backend.api.PayloadUtils.trimToNull;
import static com.queryeer.backend.queryengine.jdbc.JdbcConnection.KEY_USERNAME;

import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.stream.Collectors;

import com.queryeer.backend.api.ConfigService;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.PayloadUtils;
import com.queryeer.backend.api.SettingsModule;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcConnections;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryEventListener;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryRequest;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcResultColumn;

public final class DefaultJdbcConnections implements JdbcConnections
{
    static final String MODULE_ID = "core.queryengine.jdbc";
    private static final String CONNECTIONS_KEY = "core.queryengine.jdbc.connections";
    private static final String ENGINE_ID = "jdbc";
    private static final String CONNECTION_TEST_EXECUTION_ID = "connection-test";
    private static final String CONNECTION_TEST_QUERY = "select 1";
    private static final String ERROR_CONNECTION_FAILED = "Connection failed: ";
    private static final String KEY_URL = "url";
    private static final String KEY_PASSWORD = "password";

    private final ConfigService config;
    private final PayloadMapper payloadMapper;
    private final JdbcDialectRegistry dialectRegistry;

    DefaultJdbcConnections(ConfigService config, PayloadMapper payloadMapper, JdbcDialectRegistry dialectRegistry)
    {
        this.config = config;
        this.payloadMapper = payloadMapper;
        this.dialectRegistry = dialectRegistry;
    }

    private Optional<StoredConnection> getStored(String connectionId)
    {
        return configuredById().entrySet()
                .stream()
                .filter(entry -> connectionId.equals(entry.getKey()))
                .map(Map.Entry::getValue)
                .findFirst();
    }

    public List<String> allConfiguredConnectionIds()
    {
        return configuredById().keySet()
                .stream()
                .toList();
    }

    @Override
    public JdbcConnection resolve(String connectionId)
    {
        String normalizedConnectionId = trimToNull(connectionId);
        if (normalizedConnectionId == null)
        {
            throw new IllegalArgumentException("connectionId is required");
        }

        StoredConnection stored = getStored(normalizedConnectionId).orElseThrow(() -> new IllegalArgumentException("Unknown connectionId: " + normalizedConnectionId));
        return resolve(stored);
    }

    private JdbcConnection resolve(StoredConnection stored)
    {
        // Normalize so that all properties are placed inside the properties map on the resolved connection
        // url / password are stored outside
        // TODO: See if this can be fixed in UI-side to everything property related are located in side the props
        Map<String, Object> props = new HashMap<>(PayloadUtils.getIfNull(stored.properties, new HashMap<>()));
        props.put(KEY_URL, stored.url);
        if (stored.password != null)
        {
            props.put(KEY_PASSWORD, config.materializeSecrets(stored.password));
        }
        if (stored.username != null)
        {
            props.put(KEY_USERNAME, stored.username);

        }
        // Seal it
        props = Collections.unmodifiableMap(props);

        String dialectId = stored.dialectId != null ? stored.dialectId
                : ENGINE_ID;
        JdbcDialect dialect = dialectRegistry.find(dialectId)
                .orElseThrow(() -> new IllegalArgumentException("Unsupported JDBC dialect: " + dialectId));
        // Validate that the connection has a URL
        validateConnectionUrl(dialect, props, stored.connectionId());

        return new JdbcConnection(stored.connectionId(), stored.title(), dialect, props);
    }

    /** Test payload is the same as the stored connection format. */
    void testConnection(JdbcConnectionTestPayload testPayload)
    {
        StoredConnection stored = payloadMapper.convert(testPayload.connection(), StoredConnection.class);
        JdbcConnection resolved = resolve(stored);
        try
        {
            resolved.dialect()
                    .queryExecutor()
                    .execute(new JdbcQueryRequest(CONNECTION_TEST_EXECUTION_ID, null, CONNECTION_TEST_QUERY, resolved.connectionId(), resolved.properties(), null, null, resolved.dialect()),
                            new NoopJdbcQueryEventListener());
        }
        catch (RuntimeException e)
        {
            throw new IllegalArgumentException(ERROR_CONNECTION_FAILED + e.getMessage(), e);
        }
    }

    /** Represents a connection on disk, raw information. */
    private record StoredConnection(String connectionId, String title, String dialectId, Boolean enabled, String url, String username, Object password, Map<String, Object> properties, long version)
    {
        @SuppressWarnings("unused")
        StoredConnection
        {
            enabled = PayloadUtils.getIfNull(enabled, true);
        }
    }

    private Map<String, StoredConnection> configuredById()
    {
        SettingsModule module = config.getModule(MODULE_ID);
        if (module == null)
        {
            return new LinkedHashMap<>();
        }

        Object rawConnections = module.values()
                .get(CONNECTIONS_KEY);
        List<StoredConnection> entries = payloadMapper.convertToList(rawConnections, StoredConnection.class);

        Predicate<StoredConnection> filter = c ->
        {
            if (PayloadUtils.isBlank(c.connectionId)
                    || !c.enabled
                    || (c.url == null
                            && c.properties == null))
            {
                return false;
            }
            return true;
        };

        //@formatter:off
        return entries.stream()
                // Skip broken/disabled connections
                .filter(filter)
                .collect(Collectors.toMap(
                        c -> c.connectionId(),
                        Function.identity(),
                        (existing, _) -> existing));
        //@formatter:on
    }

    private static void validateConnectionUrl(JdbcDialect dialect, Map<String, Object> properties, String connectionId)
    {
        String url;
        try
        {
            url = dialect.buildUrl(properties);
        }
        catch (RuntimeException e)
        {
            throw new IllegalArgumentException("Connection has no url configured: " + connectionId + " (" + e.getMessage() + ")", e);
        }
        if (PayloadUtils.isBlank(url))
        {
            throw new IllegalArgumentException("Connection has no url configured: " + connectionId);
        }
    }

    private static final class NoopJdbcQueryEventListener implements JdbcQueryEventListener
    {
        @Override
        public void onResultSetStart(List<JdbcResultColumn> columns)
        {
        }

        @Override
        public void onRows(List<List<Object>> rows)
        {
        }
    }
}
