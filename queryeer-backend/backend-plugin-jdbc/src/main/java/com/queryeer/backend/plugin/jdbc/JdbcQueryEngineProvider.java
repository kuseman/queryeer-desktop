package com.queryeer.backend.plugin.jdbc;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.queryeer.backend.api.ErrorMessages;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.api.FileSessionHandler;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SecretService;
import com.queryeer.backend.queryengine.jdbc.CancellableJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionFieldDefinition;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionFieldOption;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionFieldType;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionSetupDefinition;
import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcQueryEventListener;
import com.queryeer.backend.queryengine.jdbc.JdbcQueryRequest;
import com.queryeer.backend.queryengine.jdbc.JdbcResultColumn;

final class JdbcQueryEngineProvider implements QueryEngineProvider, FileSessionHandler
{
    private static final String ENGINE_ID = "jdbc";
    private static final String ACTION_CONNECTION_UPSERT = "connection.upsert";
    private static final String ACTION_ENGINE_CAPABILITIES = "engine.capabilities";
    private static final String ACTION_CONNECTION_SETUP = "jdbc.connection.setup";
    private static final String ACTION_CONNECTION_DIALECTS = "jdbc.connection.dialects";
    private static final String ACTION_CONNECTION_TEST = "jdbc.connection.test";
    private static final String ACTION_SCHEMA_SNAPSHOT = "jdbc.schema.snapshot";
    private static final String ACTION_SCHEMA_REFRESH = "jdbc.schema.refresh";
    private static final String ACTION_SCHEMA_FETCH = "jdbc.schema.fetch";
    private final JdbcDialectRegistry registry;
    private final JdbcConnectionRegistry connections;
    private final SecretService secrets;
    private final JdbcFileConnectionManager fileConnections;
    private final JdbcConnectionUsageListener usageListener;
    private final JdbcSchemaStore schemaStore;
    private final JdbcSchemaCrawlCoordinator crawlCoordinator;
    private final Map<String, CancellableJdbcQueryExecutor> activeExecutors = new ConcurrentHashMap<>();
    private final Set<String> cancelledExecutionIds = ConcurrentHashMap.newKeySet();

    JdbcQueryEngineProvider(JdbcDialectRegistry registry, JdbcConnectionRegistry connections, SecretService secrets, JdbcFileConnectionManager fileConnections,
            JdbcConnectionUsageListener usageListener, JdbcSchemaStore schemaStore, JdbcSchemaCrawlCoordinator crawlCoordinator)
    {
        this.registry = registry;
        this.connections = connections;
        this.secrets = secrets;
        this.fileConnections = fileConnections;
        this.usageListener = usageListener;
        this.schemaStore = schemaStore;
        this.crawlCoordinator = crawlCoordinator;
    }

    @Override
    public String engineId()
    {
        return ENGINE_ID;
    }

    @Override
    public void execute(String queryExecutionId, String fileId, String text, Object engineState, QueryPublisher publisher)
    {
        long startedAt = System.currentTimeMillis();
        long rowCount = 0L;
        try
        {
            if (text == null
                    || text.isBlank())
            {
                throw new IllegalArgumentException("SQL text is required");
            }
            if (fileId == null
                    || fileId.isBlank())
            {
                throw new IllegalArgumentException("fileId is required for JDBC query execution");
            }

            JdbcExecutionState state = requireExecutionState(engineState);
            if (cancelledExecutionIds.contains(queryExecutionId))
            {
                throw new QueryCancelledException();
            }

            JdbcDialect dialect = registry.find(state.dialectId())
                    .orElseThrow(() -> new IllegalArgumentException("Unsupported JDBC dialect: " + state.dialectId()));
            JdbcConnectionProfile connectionProfile = toConnectionProfile(state);
            Connection sessionConnection = fileConnections.acquire(fileId, state);
            JdbcQueryRequest request = new JdbcQueryRequest(queryExecutionId, fileId, text, List.of(), connectionProfile, sessionConnection);

            if (dialect.queryExecutor() instanceof CancellableJdbcQueryExecutor cancellable)
            {
                activeExecutors.put(queryExecutionId, cancellable);
            }

            rowCount = dialect.queryExecutor()
                    .execute(request, new TransportJdbcQueryEventListener(publisher))
                    .rowCount();

            usageListener.onUsage(state.connectionId());

            publisher.completed(System.currentTimeMillis() - startedAt, rowCount);
        }
        catch (IllegalArgumentException e)
        {
            publisher.failed("VALIDATION", e.getMessage());
        }
        catch (QueryCancelledException e)
        {
            publisher.failed("CANCELLED", "Execution cancelled by client");
        }
        catch (Exception e)
        {
            if (cancelledExecutionIds.contains(queryExecutionId)
                    || containsCancelledState(e))
            {
                publisher.failed("CANCELLED", "Execution cancelled by client");
            }
            else
            {
                publisher.failed("INTERNAL", ErrorMessages.buildFailureMessage(e));
            }
        }
        finally
        {
            activeExecutors.remove(queryExecutionId);
            cancelledExecutionIds.remove(queryExecutionId);
        }
    }

    @Override
    public void cancel(String queryExecutionId)
    {
        cancelledExecutionIds.add(queryExecutionId);
        CancellableJdbcQueryExecutor executor = activeExecutors.get(queryExecutionId);
        if (executor != null)
        {
            executor.cancel(queryExecutionId);
        }
    }

    @Override
    public Object invoke(String fileId, String action, Object payload)
    {
        return switch (action)
        {
            case ACTION_CONNECTION_SETUP -> connectionSetup();
            case ACTION_CONNECTION_DIALECTS -> registry.all();
            case ACTION_CONNECTION_TEST -> connectionTest(payload);
            case ACTION_SCHEMA_SNAPSHOT -> schemaSnapshot(payload);
            case ACTION_SCHEMA_REFRESH -> schemaRefresh(payload);
            case ACTION_SCHEMA_FETCH -> schemaFetch(payload);
            case ACTION_CONNECTION_UPSERT -> connectionUpsert(payload);
            case ACTION_ENGINE_CAPABILITIES -> engineCapabilities();
            default -> QueryEngineProvider.super.invoke(fileId, action, payload);
        };
    }

    private JdbcConnectionSetupDefinition connectionSetup()
    {
        return new JdbcConnectionSetupDefinition(List.of(new JdbcConnectionFieldDefinition("dialectId", "Dialect", JdbcConnectionFieldType.SELECT, true, "Select JDBC dialect", registry.all()
                .stream()
                .map(metadata -> new JdbcConnectionFieldOption(metadata.id(), metadata.displayName()))
                .toList(), ENGINE_ID), new JdbcConnectionFieldDefinition("url", "JDBC URL", JdbcConnectionFieldType.TEXT, true, "Example: jdbc:postgresql://localhost:5432/appdb", List.of(), null),
                new JdbcConnectionFieldDefinition("username", "Username", JdbcConnectionFieldType.TEXT, false, null, List.of(), null),
                new JdbcConnectionFieldDefinition("password", "Password", JdbcConnectionFieldType.SECRET, false, "Stored in security vault", List.of(), null)));
    }

    private Object connectionTest(Object payload)
    {
        JdbcExecutionState state = resolvePayloadExecutionState(payload);
        if (registry.find(state.dialectId())
                .isEmpty())
        {
            throw new IllegalArgumentException("Unsupported JDBC dialect: " + state.dialectId());
        }
        JdbcExecutionState validatedState = requireUrlAndDialect(state);
        JdbcConnectionProfile connectionProfile = toConnectionProfile(validatedState);
        try
        {
            JdbcDialect dialect = registry.find(validatedState.dialectId())
                    .orElseThrow(() -> new IllegalArgumentException("Unsupported JDBC dialect: " + validatedState.dialectId()));
            dialect.queryExecutor()
                    .execute(new JdbcQueryRequest("connection-test", null, "select 1", List.of(), connectionProfile, null), new NoopJdbcQueryEventListener());
            return Map.of("ok", true, "message", "Connection successful");
        }
        catch (RuntimeException e)
        {
            throw new IllegalArgumentException("Connection failed: " + e.getMessage(), e);
        }
    }

    private Object connectionUpsert(Object payload)
    {
        Map<String, Object> value = asMap(payload);
        String connectionId = stringValue(value.get("connectionId"));
        if (connectionId == null
                || connectionId.isBlank())
        {
            throw new IllegalArgumentException("connectionId is required");
        }

        Map<String, Object> connection = asMap(value.get("connection"));
        JdbcConnectionRegistry.JdbcStoredConnection stored = connections.upsert(connectionId, stringValue(value.get("name")), connection);
        crawlCoordinator.onConnectionUpsert(connectionId);
        return Map.of("connectionId", stored.connectionId(), "version", stored.version()
                .get());
    }

    private Object engineCapabilities()
    {
        return Map.of("actions", List.of(ACTION_ENGINE_CAPABILITIES, ACTION_CONNECTION_UPSERT, ACTION_CONNECTION_SETUP, ACTION_CONNECTION_DIALECTS, ACTION_CONNECTION_TEST, ACTION_SCHEMA_SNAPSHOT,
                ACTION_SCHEMA_REFRESH, ACTION_SCHEMA_FETCH));
    }

    private Object schemaFetch(Object payload)
    {
        Map<String, Object> value = asMap(payload);
        String connectionId = stringValue(value.get("connectionId"));
        if (connectionId == null)
        {
            throw new IllegalArgumentException("connectionId is required");
        }
        JdbcConnectionRegistry.JdbcStoredConnection stored = connections.get(connectionId)
                .orElseThrow(() -> new IllegalArgumentException("Unknown connectionId: " + connectionId));
        String rawDialectId = stringValue(stored.connection()
                .get("dialectId"));
        String dialectId = rawDialectId != null ? rawDialectId
                : ENGINE_ID;
        String url = stringValue(stored.connection()
                .get("url"));
        String username = stringValue(stored.connection()
                .get("username"));
        String password = secretValue(stored.connection()
                .get("password"));
        if (url == null)
        {
            throw new IllegalArgumentException("Connection has no url configured: " + connectionId);
        }
        JdbcDialect dialect = registry.find(dialectId)
                .orElseThrow(() -> new IllegalArgumentException("Unsupported JDBC dialect: " + dialectId));
        JdbcConnectionProfile profile = new JdbcConnectionProfile(connectionId, stored.name(), dialectId, Map.of("url", url, "username", username == null ? ""
                : username, "password",
                password == null ? ""
                        : password));
        String scope = stringValue(value.get("scope"));
        Map<String, Object> targetMap = asMap(value.get("target"));
        Map<String, Object> options = new java.util.HashMap<>();
        if (scope != null)
        {
            options.put("scope", scope);
        }
        if (!targetMap.isEmpty())
        {
            options.put("target", targetMap);
        }
        return dialect.schemaResolver()
                .resolveSchema(profile, options);
    }

    private Object schemaSnapshot(Object payload)
    {
        Map<String, Object> value = asMap(payload);
        String connectionId = stringValue(value.get("connectionId"));
        if (connectionId == null)
        {
            throw new IllegalArgumentException("connectionId is required");
        }
        String scope = stringValue(value.get("scope"));
        JdbcSchemaCrawlScope crawlScope = "deep".equalsIgnoreCase(scope) ? JdbcSchemaCrawlScope.DEEP
                : JdbcSchemaCrawlScope.TOP;
        return schemaStore.latestSnapshot(connectionId, crawlScope);
    }

    private Object schemaRefresh(Object payload)
    {
        Map<String, Object> value = asMap(payload);
        String connectionId = stringValue(value.get("connectionId"));
        if (connectionId == null)
        {
            throw new IllegalArgumentException("connectionId is required");
        }
        String scope = stringValue(value.get("scope"));
        JdbcSchemaCrawlScope crawlScope;
        if (scope == null
                || "top".equalsIgnoreCase(scope))
        {
            crawlScope = JdbcSchemaCrawlScope.TOP;
        }
        else if ("deep".equalsIgnoreCase(scope))
        {
            crawlScope = JdbcSchemaCrawlScope.DEEP;
        }
        else
        {
            throw new IllegalArgumentException("scope must be one of: top, deep");
        }
        JdbcSchemaTarget target = null;
        if (crawlScope == JdbcSchemaCrawlScope.DEEP)
        {
            Map<String, Object> targetMap = asMap(value.get("target"));
            String schema = stringValue(targetMap.get("schema"));
            if (schema == null)
            {
                throw new IllegalArgumentException("target.schema is required for scope=deep");
            }
            target = new JdbcSchemaTarget(stringValue(targetMap.get("database")), schema);
        }
        return crawlCoordinator.refreshNow(connectionId, crawlScope, target);
    }

    private JdbcExecutionState resolveExecutionState(Object engineState)
    {
        JdbcExecutionState state = JdbcExecutionState.parse(engineState);
        if (state.url() != null
                && !state.url()
                        .isBlank())
        {
            return state;
        }
        if (state.connectionId() == null
                || state.connectionId()
                        .isBlank())
        {
            return state;
        }

        JdbcConnectionRegistry.JdbcStoredConnection stored = connections.get(state.connectionId())
                .orElse(null);
        if (stored == null)
        {
            return state;
        }

        String dialectId = stringValue(stored.connection()
                .get("dialectId"));
        String url = stringValue(stored.connection()
                .get("url"));
        String password = secretValue(stored.connection()
                .get("password"));
        String username = stringValue(stored.connection()
                .get("username"));
        return new JdbcExecutionState(stored.connectionId(), dialectId == null ? ENGINE_ID
                : dialectId, url, username, password);
    }

    private JdbcExecutionState requireExecutionState(Object engineState)
    {
        JdbcExecutionState state = resolveExecutionState(engineState);
        if (registry.find(state.dialectId())
                .isEmpty())
        {
            throw new IllegalArgumentException("Unsupported JDBC dialect: " + state.dialectId());
        }
        return requireUrlAndDialect(state);
    }

    private JdbcExecutionState requireUrlAndDialect(JdbcExecutionState state)
    {
        if (state.url() == null
                || state.url()
                        .isBlank())
        {
            throw new IllegalArgumentException("JDBC connection url is required");
        }
        return state;
    }

    private JdbcExecutionState resolvePayloadExecutionState(Object payload)
    {
        Map<String, Object> connection = asMap(payload);
        String dialectId = stringValue(connection.get("dialectId"));
        String url = stringValue(connection.get("url"));
        String username = stringValue(connection.get("username"));
        String password = secretValue(connection.get("password"));
        return new JdbcExecutionState(null, dialectId == null ? ENGINE_ID
                : dialectId, url, username, password);
    }

    private JdbcConnectionProfile toConnectionProfile(JdbcExecutionState state)
    {
        return new JdbcConnectionProfile(state.connectionId(), null, state.dialectId(), Map.of("url", state.url(), "username", state.username() == null ? ""
                : state.username(), "password",
                state.resolvedPassword() == null ? ""
                        : state.resolvedPassword()));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object value)
    {
        if (!(value instanceof Map<?, ?> map))
        {
            return Map.of();
        }

        return (Map<String, Object>) map;
    }

    private static String stringValue(Object value)
    {
        if (value instanceof String stringValue)
        {
            String trimmed = stringValue.trim();
            return trimmed.isBlank() ? null
                    : trimmed;
        }
        return null;
    }

    private String secretValue(Object value)
    {
        if (value instanceof Map<?, ?> map)
        {
            String secretRef = stringValue(map.get("secretRef"));
            if (secretRef == null)
            {
                return null;
            }
            char[] chars = secrets.getSecret(secretRef);
            if (chars == null)
            {
                return null;
            }
            return new String(chars);
        }
        return stringValue(value);
    }

    private static final class QueryCancelledException extends RuntimeException
    {
        private static final long serialVersionUID = 1L;
    }

    private static final class TransportJdbcQueryEventListener implements com.queryeer.backend.queryengine.jdbc.JdbcQueryEventListener
    {
        private final QueryPublisher publisher;

        private TransportJdbcQueryEventListener(QueryPublisher publisher)
        {
            this.publisher = publisher;
        }

        @Override
        public void onResultSetStart(List<com.queryeer.backend.queryengine.jdbc.JdbcResultColumn> columns)
        {
            publisher.resultSetStart(columns.stream()
                    .map(c -> c.name())
                    .toList(),
                    columns.stream()
                            .map(c -> c.type())
                            .toList());
        }

        @Override
        public void onRows(List<List<Object>> rows)
        {
            publisher.resultSetRows(rows);
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

    private static boolean containsCancelledState(Throwable throwable)
    {
        Throwable current = throwable;
        while (current != null)
        {
            if (current instanceof SQLException sqlException
                    && "57014".equals(sqlException.getSQLState()))
            {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    @Override
    public void onClose(FileSession session)
    {
        fileConnections.closeFile(session.fileId());
    }
}
