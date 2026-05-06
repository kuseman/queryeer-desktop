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
import com.queryeer.backend.api.OutputEvent;
import com.queryeer.backend.api.OutputSeverity;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.contract.connection.ConnectionUpsertParams;
import com.queryeer.backend.contract.engine.JdbcSchemaRefreshPayload;
import com.queryeer.backend.contract.jdbc.JdbcConnectionProperties;
import com.queryeer.backend.contract.jdbc.JdbcEngineState;
import com.queryeer.backend.contract.jdbc.JdbcSchemaFetchPayload;
import com.queryeer.backend.contract.jdbc.JdbcSchemaSnapshotPayload;
import com.queryeer.backend.queryengine.jdbc.CancellableJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionFieldDefinition;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionFieldOption;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionFieldType;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionProfile;
import com.queryeer.backend.queryengine.jdbc.JdbcConnectionSetupDefinition;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.JdbcQueryEventListener;
import com.queryeer.backend.queryengine.jdbc.JdbcQueryRequest;
import com.queryeer.backend.queryengine.jdbc.JdbcQueryResult;
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
    private static final String ACTION_CONNECTION_SESSIONS = "jdbc.connection.sessions";

    private static final String ERROR_CODE_VALIDATION = "VALIDATION";
    private static final String ERROR_CODE_CANCELLED = "CANCELLED";
    private static final String ERROR_CODE_INTERNAL = "INTERNAL";

    private static final String SQLSTATE_QUERY_CANCELLED = "57014";

    private static final String FIELD_DIALECT_ID = "dialectId";
    private static final String FIELD_URL = "url";
    private static final String FIELD_USERNAME = "username";
    private static final String FIELD_PASSWORD = "password";

    private static final String SCOPE_TOP = "top";
    private static final String SCOPE_DEEP = "deep";
    private static final String SCOPE_TABLES = "tables";
    private static final String SCOPE_COLUMNS = "columns";
    private static final String DEFAULT_DATABASE_NODE = "default";

    private static final String OPTION_SCOPE = "scope";
    private static final String OPTION_TARGET = "target";

    private static final String KEY_OK = "ok";
    private static final String KEY_MESSAGE = "message";
    private static final String KEY_CONNECTION_ID = "connectionId";
    private static final String KEY_VERSION = "version";
    private static final String KEY_ACTIONS = "actions";

    private static final String CONNECTION_TEST_EXECUTION_ID = "connection-test";
    private static final String CONNECTION_TEST_QUERY = "select 1";

    private static final String ERROR_SQL_TEXT_REQUIRED = "SQL text is required";
    private static final String ERROR_FILE_ID_REQUIRED = "fileId is required for JDBC query execution";
    private static final String ERROR_CANCELLED_MESSAGE = "Execution cancelled by client";
    private static final String ERROR_CONNECTION_FAILED = "Connection failed: ";
    private static final String ERROR_CONNECTION_ID_REQUIRED = "connectionId is required";
    private static final String ERROR_TARGET_SCHEMA_REQUIRED = "target.schema is required for scope=deep";

    private final JdbcDialectRegistry registry;
    private final JdbcConnectionRegistry connections;
    private final JdbcFileConnectionManager fileConnections;
    private final JdbcConnectionUsageListener usageListener;
    private final JdbcSchemaStore schemaStore;
    private final JdbcSchemaCrawlCoordinator crawlCoordinator;
    private final JdbcCredentialResolver credentialResolver;
    private final PayloadMapper payloadMapper;
    private final Map<String, CancellableJdbcQueryExecutor> activeExecutors = new ConcurrentHashMap<>();
    private final Set<String> cancelledExecutionIds = ConcurrentHashMap.newKeySet();

    JdbcQueryEngineProvider(JdbcDialectRegistry registry, JdbcConnectionRegistry connections, JdbcFileConnectionManager fileConnections, JdbcConnectionUsageListener usageListener,
            JdbcSchemaStore schemaStore, JdbcSchemaCrawlCoordinator crawlCoordinator, JdbcCredentialResolver credentialResolver, PayloadMapper payloadMapper)
    {
        this.registry = registry;
        this.connections = connections;
        this.fileConnections = fileConnections;
        this.usageListener = usageListener;
        this.schemaStore = schemaStore;
        this.crawlCoordinator = crawlCoordinator;
        this.credentialResolver = credentialResolver;
        this.payloadMapper = payloadMapper;
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
        String sessionId = null;
        try
        {
            if (text == null
                    || text.isBlank())
            {
                throw new IllegalArgumentException(ERROR_SQL_TEXT_REQUIRED);
            }
            if (fileId == null
                    || fileId.isBlank())
            {
                throw new IllegalArgumentException(ERROR_FILE_ID_REQUIRED);
            }
            if (cancelledExecutionIds.contains(queryExecutionId))
            {
                throw new QueryCancelledException();
            }

            JdbcEngineState state = payloadMapper.convert(engineState, JdbcEngineState.class);
            JdbcResolvedConnection resolved = JdbcResolvedConnection.fromEngineState(state, connections, registry);
            JdbcConnectionProfile materializedProfile = credentialResolver.resolve(resolved.profile());

            Connection sessionConnection = fileConnections.acquire(fileId, materializedProfile, resolved.dialect());

            sessionId = trimToNull(state.sessionId());
            sessionId = fileConnections.resolveSessionId(fileId, materializedProfile, resolved, sessionId);
            fileConnections.rememberSessionId(fileId, sessionId);

            JdbcQueryRequest request = new JdbcQueryRequest(queryExecutionId, fileId, text, List.of(), materializedProfile, sessionConnection, state.database(), resolved.dialect());

            if (resolved.dialect()
                    .queryExecutor() instanceof CancellableJdbcQueryExecutor cancellable)
            {
                activeExecutors.put(queryExecutionId, cancellable);
            }

            JdbcQueryResult result = resolved.dialect()
                    .queryExecutor()
                    .execute(request, new TransportJdbcQueryEventListener(publisher));

            Map<String, Object> engineStatePatch = new java.util.LinkedHashMap<>();
            if (result.engineState() != null)
            {
                engineStatePatch.putAll(result.engineState());
            }
            if (sessionId != null
                    && !sessionId.isBlank())
            {
                engineStatePatch.put("sessionId", sessionId);
            }

            usageListener.onUsage(resolved.connectionId());
            publisher.completed(System.currentTimeMillis() - startedAt, result.rowCount(), engineStatePatch);
        }
        catch (IllegalArgumentException e)
        {
            publisher.failed(ERROR_CODE_VALIDATION, e.getMessage());
        }
        catch (QueryCancelledException e)
        {
            publisher.failed(ERROR_CODE_CANCELLED, ERROR_CANCELLED_MESSAGE);
        }
        catch (SecuritySessionClosedException e)
        {
            throw e;
        }
        catch (Exception e)
        {
            if (cancelledExecutionIds.contains(queryExecutionId)
                    || containsCancelledState(e))
            {
                publisher.failed(ERROR_CODE_CANCELLED, ERROR_CANCELLED_MESSAGE);
            }
            else
            {
                publisher.failed(ERROR_CODE_INTERNAL, ErrorMessages.buildFailureMessage(e), sessionId != null ? Map.of("sessionId", sessionId)
                        : null);
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
            case ACTION_CONNECTION_SESSIONS -> connectionSessions();
            case ACTION_CONNECTION_UPSERT -> connectionUpsert(payload);
            case ACTION_ENGINE_CAPABILITIES -> engineCapabilities();
            default -> QueryEngineProvider.super.invoke(fileId, action, payload);
        };
    }

    private JdbcConnectionSetupDefinition connectionSetup()
    {
        return new JdbcConnectionSetupDefinition(List.of(new JdbcConnectionFieldDefinition(FIELD_DIALECT_ID, "Dialect", JdbcConnectionFieldType.SELECT, true, "Select JDBC dialect", registry.all()
                .stream()
                .map(metadata -> new JdbcConnectionFieldOption(metadata.id(), metadata.displayName()))
                .toList(), ENGINE_ID, null),
                new JdbcConnectionFieldDefinition(FIELD_URL, "JDBC URL", JdbcConnectionFieldType.TEXT, true, "Example: jdbc:postgresql://localhost:5432/appdb", List.of(), null, null),
                new JdbcConnectionFieldDefinition(FIELD_USERNAME, "Username", JdbcConnectionFieldType.TEXT, false, null, List.of(), null, null),
                new JdbcConnectionFieldDefinition(FIELD_PASSWORD, "Password", JdbcConnectionFieldType.SECRET, false, "Stored in security vault", List.of(), null, null)));
    }

    private Object connectionTest(Object payload)
    {
        JdbcConnectionProperties properties = payloadMapper.convert(payload, JdbcConnectionProperties.class);
        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromProperties(properties, null, registry);
        JdbcConnectionProfile materializedProfile = credentialResolver.resolve(resolved.profile());
        try
        {
            resolved.dialect()
                    .queryExecutor()
                    .execute(new JdbcQueryRequest(CONNECTION_TEST_EXECUTION_ID, null, CONNECTION_TEST_QUERY, List.of(), materializedProfile, null, null, resolved.dialect()),
                            new NoopJdbcQueryEventListener());
            return Map.of(KEY_OK, true, KEY_MESSAGE, "Connection successful");
        }
        catch (RuntimeException e)
        {
            throw new IllegalArgumentException(ERROR_CONNECTION_FAILED + e.getMessage(), e);
        }
    }

    private Object connectionUpsert(Object payload)
    {
        ConnectionUpsertParams params = payloadMapper.convert(payload, ConnectionUpsertParams.class);
        String connectionId = trimToNull(params.connectionId());
        if (connectionId == null)
        {
            throw new IllegalArgumentException(ERROR_CONNECTION_ID_REQUIRED);
        }

        @SuppressWarnings("unchecked")
        java.util.Map<String, Object> connection = payloadMapper.convert(params.connection(), java.util.Map.class);
        JdbcConnectionRegistry.JdbcStoredConnection stored = connections.upsert(connectionId, trimToNull(params.name()), connection);
        crawlCoordinator.onConnectionUpsert(connectionId);
        return Map.of(KEY_CONNECTION_ID, stored.connectionId(), KEY_VERSION, stored.version()
                .get());
    }

    private Object engineCapabilities()
    {
        return Map.of(KEY_ACTIONS, List.of(ACTION_ENGINE_CAPABILITIES, ACTION_CONNECTION_UPSERT, ACTION_CONNECTION_SETUP, ACTION_CONNECTION_DIALECTS, ACTION_CONNECTION_TEST, ACTION_SCHEMA_SNAPSHOT,
                ACTION_SCHEMA_REFRESH, ACTION_SCHEMA_FETCH, ACTION_CONNECTION_SESSIONS));
    }

    private Object connectionSessions()
    {
        return fileConnections.connectionSnapshots(System.currentTimeMillis());
    }

    private Object schemaFetch(Object payload)
    {
        JdbcSchemaFetchPayload params = payloadMapper.convert(payload, JdbcSchemaFetchPayload.class);
        JdbcResolvedConnection resolved = JdbcResolvedConnection.fromRegistryWithOverrides(params, connections, registry);
        JdbcConnectionProfile materializedProfile = credentialResolver.resolve(resolved.profile());

        Map<String, Object> options = new java.util.HashMap<>();
        if (params.scope() != null)
        {
            options.put(OPTION_SCOPE, params.scope());
        }
        if (params.target() != null)
        {
            options.put(OPTION_TARGET, params.target());
        }
        List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> result = resolved.dialect()
                .schemaResolver()
                .resolveSchema(materializedProfile, options);
        persistDeepCacheFromFetch(resolved.connectionId(), params, result);
        return result;
    }

    private Object schemaSnapshot(Object payload)
    {
        JdbcSchemaSnapshotPayload params = payloadMapper.convert(payload, JdbcSchemaSnapshotPayload.class);
        String connectionId = trimToNull(params.connectionId());
        if (connectionId == null)
        {
            throw new IllegalArgumentException(ERROR_CONNECTION_ID_REQUIRED);
        }
        String scope = trimToNull(params.scope());
        JdbcSchemaCrawlScope crawlScope = SCOPE_DEEP.equalsIgnoreCase(scope) ? JdbcSchemaCrawlScope.DEEP
                : JdbcSchemaCrawlScope.TOP;
        List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> snapshot = schemaStore.latestSnapshot(connectionId, crawlScope);
        if (!snapshot.isEmpty()
                || crawlScope != JdbcSchemaCrawlScope.TOP)
        {
            return snapshot;
        }
        try
        {
            return crawlCoordinator.refreshNow(connectionId, JdbcSchemaCrawlScope.TOP, null);
        }
        catch (RuntimeException e)
        {
            return snapshot;
        }
    }

    private Object schemaRefresh(Object payload)
    {
        JdbcSchemaRefreshPayload params = payloadMapper.convert(payload, JdbcSchemaRefreshPayload.class);
        String connectionId = trimToNull(params.connectionId());
        if (connectionId == null)
        {
            throw new IllegalArgumentException(ERROR_CONNECTION_ID_REQUIRED);
        }
        String scope = trimToNull(params.scope());
        JdbcSchemaCrawlScope crawlScope;
        if (scope == null
                || SCOPE_TOP.equalsIgnoreCase(scope))
        {
            crawlScope = JdbcSchemaCrawlScope.TOP;
        }
        else if (SCOPE_DEEP.equalsIgnoreCase(scope))
        {
            crawlScope = JdbcSchemaCrawlScope.DEEP;
        }
        else
        {
            throw new IllegalArgumentException("scope must be one of: " + SCOPE_TOP + ", " + SCOPE_DEEP);
        }
        JdbcSchemaTarget target = null;
        if (crawlScope == JdbcSchemaCrawlScope.DEEP)
        {
            com.queryeer.backend.contract.jdbc.JdbcSchemaTarget t = params.target();
            String schema = t != null ? trimToNull(t.schema())
                    : null;
            if (schema == null)
            {
                throw new IllegalArgumentException(ERROR_TARGET_SCHEMA_REQUIRED);
            }
            target = new JdbcSchemaTarget(t != null ? trimToNull(t.database())
                    : null, schema);
        }
        return crawlCoordinator.refreshNow(connectionId, crawlScope, target);
    }

    private void persistDeepCacheFromFetch(String connectionId, JdbcSchemaFetchPayload params, List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> fetched)
    {
        if (fetched == null
                || fetched.isEmpty())
        {
            return;
        }
        String scope = trimToNull(params.scope());
        if (!SCOPE_TABLES.equalsIgnoreCase(scope)
                && !SCOPE_COLUMNS.equalsIgnoreCase(scope))
        {
            return;
        }
        try
        {
            List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> current = new java.util.ArrayList<>(schemaStore.latestSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP));
            com.queryeer.backend.contract.jdbc.JdbcSchemaTarget target = params.target();
            String database = target != null ? trimToNull(target.database())
                    : null;
            String schema = target != null ? trimToNull(target.schema())
                    : null;
            String table = target != null ? trimToNull(target.table())
                    : null;
            if (SCOPE_TABLES.equalsIgnoreCase(scope))
            {
                mergeTablesScope(current, database, schema, fetched);
            }
            else
            {
                mergeColumnsScope(current, database, schema, table, fetched);
            }
            schemaStore.persistSnapshot(connectionId, JdbcSchemaCrawlScope.DEEP, current);
        }
        catch (RuntimeException ignored)
        {
            // best-effort append into deep cache during navigation fetch
        }
    }

    private static void mergeTablesScope(List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> roots, String database, String schema,
            List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> fetched)
    {
        String db = database != null ? database
                : inferDatabase(fetched);
        if (db == null)
        {
            db = DEFAULT_DATABASE_NODE;
        }
        com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject dbNode = upsertChild(roots,
                new com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject("database:" + db, db, "database", List.of(), Map.of()));
        List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> dbChildren = mutableChildren(dbNode);

        if (schema == null)
        {
            mergeInto(dbChildren, fetched);
            replaceNode(roots, dbNode, withChildren(dbNode, dbChildren));
            return;
        }

        com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject schemaNode = upsertChild(dbChildren,
                new com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject(db + "." + schema, schema, "schema", List.of(), Map.of("catalog", db)));
        List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> schemaChildren = mutableChildren(schemaNode);
        mergeInto(schemaChildren, fetched);
        replaceNode(dbChildren, schemaNode, withChildren(schemaNode, schemaChildren));
        replaceNode(roots, dbNode, withChildren(dbNode, dbChildren));
    }

    private static void mergeColumnsScope(List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> roots, String database, String schema, String table,
            List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> fetched)
    {
        String db = database != null ? database
                : inferDatabase(fetched);
        if (db == null)
        {
            db = DEFAULT_DATABASE_NODE;
        }
        if (schema == null
                || table == null)
        {
            return;
        }
        com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject dbNode = upsertChild(roots,
                new com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject("database:" + db, db, "database", List.of(), Map.of()));
        List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> dbChildren = mutableChildren(dbNode);
        com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject schemaNode = upsertChild(dbChildren,
                new com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject(db + "." + schema, schema, "schema", List.of(), Map.of("catalog", db)));
        List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> schemaChildren = mutableChildren(schemaNode);
        com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject tableNode = upsertChild(schemaChildren,
                new com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject(db + "." + schema + "." + table, table, "table", List.of(), Map.of("catalog", db, "schema", schema)));
        List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> tableChildren = mutableChildren(tableNode);
        mergeInto(tableChildren, fetched);
        replaceNode(schemaChildren, tableNode, withChildren(tableNode, tableChildren));
        replaceNode(dbChildren, schemaNode, withChildren(schemaNode, schemaChildren));
        replaceNode(roots, dbNode, withChildren(dbNode, dbChildren));
    }

    private static String inferDatabase(List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> objects)
    {
        for (com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject object : objects)
        {
            Object catalog = object.attributes()
                    .get("catalog");
            if (catalog instanceof String s
                    && !s.isBlank())
            {
                return s;
            }
        }
        return null;
    }

    private static List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> mutableChildren(com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject node)
    {
        return new java.util.ArrayList<>(node.children() == null ? List.of()
                : node.children());
    }

    private static com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject withChildren(com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject node,
            List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> children)
    {
        return new com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject(node.id(), node.name(), node.kind(), List.copyOf(children), node.attributes());
    }

    private static void mergeInto(List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> target, List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> incoming)
    {
        for (com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject item : incoming)
        {
            int idx = indexOf(target, item);
            if (idx >= 0)
            {
                target.set(idx, item);
            }
            else
            {
                target.add(item);
            }
        }
    }

    private static com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject upsertChild(List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> target,
            com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject candidate)
    {
        int idx = indexOf(target, candidate);
        if (idx >= 0)
        {
            return target.get(idx);
        }
        target.add(candidate);
        return candidate;
    }

    private static int indexOf(List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> list, com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject node)
    {
        for (int i = 0; i < list.size(); i++)
        {
            com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject current = list.get(i);
            if (current.kind()
                    .equals(node.kind())
                    && current.name()
                            .equals(node.name()))
            {
                return i;
            }
        }
        return -1;
    }

    private static void replaceNode(List<com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject> list, com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject oldNode,
            com.queryeer.backend.queryengine.jdbc.JdbcSchemaObject updatedNode)
    {
        int idx = indexOf(list, oldNode);
        if (idx >= 0)
        {
            list.set(idx, updatedNode);
        }
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

    private static final class QueryCancelledException extends RuntimeException
    {
        private static final long serialVersionUID = 1L;
    }

    private static final class TransportJdbcQueryEventListener implements JdbcQueryEventListener
    {
        private final QueryPublisher publisher;

        private TransportJdbcQueryEventListener(QueryPublisher publisher)
        {
            this.publisher = publisher;
        }

        @Override
        public void onResultSetStart(List<JdbcResultColumn> columns)
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

        @Override
        public void onOutput(String message)
        {
            publisher.resultSetRows(List.of(), List.of(new OutputEvent(OutputSeverity.INFO, message)));
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
                    && SQLSTATE_QUERY_CANCELLED.equals(sqlException.getSQLState()))
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
