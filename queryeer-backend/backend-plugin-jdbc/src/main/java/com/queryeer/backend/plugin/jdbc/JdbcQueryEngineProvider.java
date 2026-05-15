package com.queryeer.backend.plugin.jdbc;

import static com.queryeer.backend.api.PayloadUtils.isBlank;
import static com.queryeer.backend.api.PayloadUtils.stringValue;
import static com.queryeer.backend.api.PayloadUtils.trimToNull;
import static com.queryeer.backend.plugin.jdbc.JdbcUtils.closeQuietly;
import static com.queryeer.backend.plugin.jdbc.JdbcUtils.rollbackAndClose;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import com.queryeer.backend.api.ErrorMessages;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.api.FileSessionHandler;
import com.queryeer.backend.api.OutputEvent;
import com.queryeer.backend.api.OutputSeverity;
import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.QueryEngineProvider;
import com.queryeer.backend.api.QueryPublisher;
import com.queryeer.backend.api.SecuritySessionClosedException;
import com.queryeer.backend.api.parse.IncrementalParseFunction;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.contract.query.QueryExecuteOptions;
import com.queryeer.backend.plugin.jdbc.schema.JdbcConnectionHealth;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaActionHandler;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaCrawlCoordinator;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaNavigator;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaRouter;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaStore;
import com.queryeer.backend.queryengine.jdbc.CancellableJdbcQueryExecutor;
import com.queryeer.backend.queryengine.jdbc.JdbcConnection;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectRegistry;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryEventListener;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryRequest;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcQueryResult;
import com.queryeer.backend.queryengine.jdbc.execute.JdbcResultColumn;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldDefinition;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldOption;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionFieldType;
import com.queryeer.backend.queryengine.jdbc.setup.JdbcConnectionSetupDefinition;
import com.queryeer.backend.queryengine.sql.parser.TreeSitterSqlParseFunction;

final class JdbcQueryEngineProvider implements QueryEngineProvider, FileSessionHandler
{
    private static final String ENGINE_ID = "jdbc";
    private static final String ACTION_ENGINE_CAPABILITIES = "engine.capabilities";
    private static final String ACTION_CONNECTION_SETUP = "jdbc.connection.setup";
    private static final String ACTION_CONNECTION_DIALECTS = "jdbc.connection.dialects";
    private static final String ACTION_CONNECTION_TEST = "jdbc.connection.test";
    private static final String ACTION_SCHEMA_SNAPSHOT = "jdbc.schema.snapshot";
    private static final String ACTION_SCHEMA_REFRESH = "jdbc.schema.refresh";
    private static final String ACTION_SCHEMA_FETCH = "jdbc.schema.fetch";
    private static final String ACTION_SCHEMA_STATUS = "jdbc.schema.status";
    private static final String ACTION_CONNECTION_SESSIONS = "jdbc.connection.sessions";
    private static final String ACTION_SQL_PARSE_SNAPSHOT = "sql.parse.snapshot";
    private static final String ACTION_SQL_COMPLETE = "sql.complete";
    private static final String ACTION_SQL_SYMBOL_AT_POSITION = "sql.symbolAtPosition";
    private static final String ACTION_SQL_HOVER = "sql.hover";

    private static final String ERROR_CODE_VALIDATION = "VALIDATION";
    private static final String ERROR_CODE_CANCELLED = "CANCELLED";
    private static final String ERROR_CODE_INTERNAL = "INTERNAL";

    private static final String SQLSTATE_QUERY_CANCELLED = "57014";

    private static final String FIELD_DIALECT_ID = "dialectId";
    private static final String FIELD_URL = "url";
    private static final String FIELD_USERNAME = "username";
    private static final String FIELD_PASSWORD = "password";

    private static final String KEY_OK = "ok";
    private static final String KEY_MESSAGE = "message";
    private static final String KEY_ACTIONS = "actions";

    private static final String ERROR_SQL_TEXT_REQUIRED = "SQL text is required";
    private static final String ERROR_FILE_ID_REQUIRED = "fileId is required for JDBC query execution";
    private static final String ERROR_CANCELLED_MESSAGE = "Execution cancelled by client";
    private static final long DEFAULT_DEAD_SNAPSHOT_TTL_MS = TimeUnit.SECONDS.toMillis(45);

    private final JdbcDialectRegistry registry;
    private final DefaultJdbcConnections connections;
    private final JdbcConnectionUsageListener usageListener;
    private final JdbcSchemaActionHandler schemaActions;
    private final JdbcSchemaNavigator schemaNavigator;
    private final JdbcSqlSemanticHandler sqlSemanticHandler;
    private final long idleTimeoutMs;
    private final PayloadMapper payloadMapper;
    private final IncrementalParseSessionService parseSessions;
    private final IncrementalParseFunction parseFunction;
    private final Map<String, CancellableJdbcQueryExecutor> activeExecutors = new ConcurrentHashMap<>();
    private final Set<String> cancelledExecutionIds = ConcurrentHashMap.newKeySet();
    private final Map<String, FileSessionHandle> byFileId = new ConcurrentHashMap<>();
    private final Map<String, DeadSessionSnapshot> deadByFileId = new ConcurrentHashMap<>();

    //@formatter:off
    JdbcQueryEngineProvider(
            JdbcDialectRegistry registry,
            DefaultJdbcConnections connections,
            long idleTimeoutMs,
            JdbcConnectionUsageListener usageListener,
            JdbcSchemaStore schemaStore,
            JdbcSchemaCrawlCoordinator crawlCoordinator,
            PayloadMapper payloadMapper,
            JdbcSchemaRouter router,
            JdbcConnectionHealth connectionHealth,
            IncrementalParseSessionService parseSessions,
            IncrementalParseFunction parseFunction)
    //@formatter:on
    {
        this.registry = registry;
        this.connections = connections;
        this.idleTimeoutMs = Math.max(0L, idleTimeoutMs);
        this.usageListener = usageListener;
        this.payloadMapper = payloadMapper;
        this.parseSessions = parseSessions;
        this.parseFunction = parseFunction;
        this.schemaNavigator = new JdbcSchemaNavigator(connections, schemaStore, router, connectionHealth);
        this.schemaActions = new JdbcSchemaActionHandler(payloadMapper, connections, router, schemaStore, crawlCoordinator, connectionHealth);
        this.sqlSemanticHandler = new JdbcSqlSemanticHandler(payloadMapper, parseSessions, engineId(), schemaNavigator, usageListener, fileId ->
        {
            FileSessionHandle session = byFileId.get(fileId);
            return session != null ? session.connectionId()
                    : null;
        });
    }

    @Override
    public String engineId()
    {
        return ENGINE_ID;
    }

    @Override
    public void execute(String queryExecutionId, String fileId, String text, Object engineState, QueryPublisher publisher)
    {
        execute(queryExecutionId, fileId, text, engineState, null, publisher);
    }

    @Override
    public void execute(String queryExecutionId, String fileId, String text, Object engineState, QueryExecuteOptions options, QueryPublisher publisher)
    {
        long startedAt = System.currentTimeMillis();
        String sessionId = null;
        JdbcConnection resolved = null;
        try
        {
            if (isBlank(text))
            {
                throw new IllegalArgumentException(ERROR_SQL_TEXT_REQUIRED);
            }
            if (isBlank(fileId))
            {
                throw new IllegalArgumentException(ERROR_FILE_ID_REQUIRED);
            }
            if (cancelledExecutionIds.contains(queryExecutionId))
            {
                throw new QueryCancelledException();
            }

            JdbcEngineState state = payloadMapper.convert(engineState, JdbcEngineState.class);
            resolved = connections.resolve(state.connectionId());

            sessionId = trimToNull(state.sessionId());
            sessionId = resolveSessionId(fileId, resolved, sessionId);
            rememberSessionId(fileId, sessionId);

            if (resolved.dialect()
                    .queryExecutor() instanceof CancellableJdbcQueryExecutor cancellable)
            {
                activeExecutors.put(queryExecutionId, cancellable);
            }

            Map<String, String> resultSetMeta = new LinkedHashMap<>();
            if (resolved.title() != null)
            {
                resultSetMeta.put("Connection", resolved.title());
            }
            if (state.database() != null)
            {
                resultSetMeta.put("Database", state.database());
            }
            Connection sessionConnection = acquire(fileId, resolved);
            JdbcQueryRequest request = new JdbcQueryRequest(queryExecutionId, fileId, text, resolved.connectionId(), resolved.properties(), sessionConnection, state.database(), resolved.dialect(),
                    options);
            JdbcQueryResult result = executeJdbcRequest(resolved, request, new TransportJdbcQueryEventListener(publisher, resultSetMeta));

            Map<String, Object> engineStatePatch = new LinkedHashMap<>();
            if (result.engineState() != null)
            {
                engineStatePatch.putAll(result.engineState());
            }
            if (!isBlank(sessionId))
            {
                engineStatePatch.put("sessionId", sessionId);
            }

            usageListener.onUsage(resolved.connectionId(), state.database());
            publisher.completed(System.currentTimeMillis() - startedAt, result.rowCount(), result.features(), result.artifacts(), engineStatePatch);
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
                Map<String, Object> details = new LinkedHashMap<>();
                if (sessionId != null)
                {
                    details.put("sessionId", sessionId);
                }
                if (resolved != null)
                {
                    details.putAll(resolved.dialect()
                            .extractErrorDetails(e));
                }
                publisher.failed(ERROR_CODE_INTERNAL, ErrorMessages.buildFailureMessage(e), details.isEmpty() ? null
                        : details);
            }
        }
        finally
        {
            activeExecutors.remove(queryExecutionId);
            cancelledExecutionIds.remove(queryExecutionId);
        }
    }

    private JdbcQueryResult executeJdbcRequest(JdbcConnection resolved, JdbcQueryRequest request, TransportJdbcQueryEventListener listener)
    {
        String intent = request.options() == null ? null
                : request.options()
                        .intent();
        if (intent != null
                && intent.startsWith("plan."))
        {
            return resolved.dialect()
                    .queryPlanExecutor()
                    .orElseThrow(() -> new IllegalArgumentException("Query plans are not supported for dialect: " + resolved.dialect()
                            .metadata()
                            .id()))
                    .executeWithPlan(request, listener);
        }
        return resolved.dialect()
                .queryExecutor()
                .execute(request, listener);
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
            case ACTION_SCHEMA_SNAPSHOT -> schemaActions.snapshot(payload);
            case ACTION_SCHEMA_REFRESH -> schemaActions.refresh(payload);
            case ACTION_SCHEMA_FETCH -> schemaActions.fetch(payload);
            case ACTION_SCHEMA_STATUS -> schemaActions.status(payload);
            case ACTION_CONNECTION_SESSIONS -> connectionSessions();
            case ACTION_SQL_PARSE_SNAPSHOT -> sqlSemanticHandler.parseSnapshot(fileId);
            case ACTION_SQL_COMPLETE -> sqlSemanticHandler.complete(fileId, payload);
            case ACTION_SQL_SYMBOL_AT_POSITION -> sqlSemanticHandler.symbolAtPosition(fileId, payload);
            case ACTION_SQL_HOVER -> sqlSemanticHandler.hover(fileId, payload);
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
        JdbcConnectionTestPayload params = payloadMapper.convert(payload, JdbcConnectionTestPayload.class);
        connections.testConnection(params);
        return Map.of(KEY_OK, true, KEY_MESSAGE, "Connection successful");
    }

    private Object engineCapabilities()
    {
        //@formatter:off
        return Map.of(KEY_ACTIONS, List.of(
                ACTION_ENGINE_CAPABILITIES,
                ACTION_CONNECTION_SETUP,
                ACTION_CONNECTION_DIALECTS,
                ACTION_CONNECTION_TEST,
                ACTION_SCHEMA_SNAPSHOT,
                ACTION_SCHEMA_REFRESH,
                ACTION_SCHEMA_FETCH,
                ACTION_SCHEMA_STATUS,
                ACTION_CONNECTION_SESSIONS,
                ACTION_SQL_PARSE_SNAPSHOT,
                ACTION_SQL_COMPLETE,
                ACTION_SQL_SYMBOL_AT_POSITION,
                ACTION_SQL_HOVER));
        //@formatter:on
    }

    private Object connectionSessions()
    {
        return connectionSnapshots(System.currentTimeMillis());
    }

    private static final class QueryCancelledException extends RuntimeException
    {
        private static final long serialVersionUID = 1L;
    }

    private static final class TransportJdbcQueryEventListener implements JdbcQueryEventListener
    {
        private final QueryPublisher publisher;
        private final Map<String, String> metadata;

        private TransportJdbcQueryEventListener(QueryPublisher publisher, Map<String, String> metadata)
        {
            this.publisher = publisher;
            this.metadata = metadata;
        }

        @Override
        public void onResultSetStart(List<JdbcResultColumn> columns)
        {
            publisher.resultSetStart(columns.stream()
                    .map(c -> c.name())
                    .toList(),
                    columns.stream()
                            .map(c -> c.type())
                            .toList(),
                    metadata);
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
    public void onOpen(FileSession session, String initialText)
    {
        JdbcConnection connection = connections.resolve(session.connectionId());
        String languageId = connection.dialect()
                .sqlGrammarId();
        parseSessions.open(engineId(), session.fileId(), session.backendVersion(), languageId, initialText, parseFunctionFor(languageId));
    }

    @Override
    public void onChange(FileSession session, long version, String text)
    {
        String languageId = parseSessions.get(engineId(), session.fileId())
                .map(s -> s.languageId())
                .orElse(TreeSitterSqlParseFunction.LANGUAGE_SQL);
        parseSessions.change(engineId(), session.fileId(), version, languageId, text, parseFunctionFor(languageId));
    }

    @Override
    public void onClose(FileSession session)
    {
        parseSessions.close(engineId(), session.fileId());
        closeFile(session.fileId());
    }

    private IncrementalParseFunction parseFunctionFor(String languageId)
    {
        return (_, text, previousState) -> parseFunction.parse(languageId, text, previousState);
    }

    void closeIdleConnections(long now)
    {
        if (idleTimeoutMs <= 0L)
        {
            return;
        }
        byFileId.forEach((fileId, session) ->
        {
            if (now - session.lastUsedAtMs() < idleTimeoutMs)
            {
                return;
            }
            if (byFileId.remove(fileId, session))
            {
                rollbackAndClose(session.connection());
                deadByFileId.put(fileId, new DeadSessionSnapshot(fileId, session.connectionId(), session.sessionId(), now + DEFAULT_DEAD_SNAPSHOT_TTL_MS));
            }
        });
        deadByFileId.forEach((fileId, snapshot) ->
        {
            if (snapshot.expiresAtMs() <= now)
            {
                deadByFileId.remove(fileId, snapshot);
            }
        });
    }

    private Connection acquire(String fileId, JdbcConnection resolved) throws SQLException
    {
        return acquireWithStatus(fileId, resolved).connection();
    }

    private AcquiredConnection acquireWithStatus(String fileId, JdbcConnection resolved) throws SQLException
    {
        long now = System.currentTimeMillis();
        AtomicBoolean createdNew = new AtomicBoolean(false);
        FileSessionHandle session = byFileId.compute(fileId, (_, existing) ->
        {
            if (existing != null
                    && existing.matches(resolved))
            {
                try
                {
                    if (!existing.connection()
                            .isClosed())
                    {
                        return existing.touch(now);
                    }
                }
                catch (SQLException e)
                {
                    closeQuietly(existing.connection());
                }
            }

            if (existing != null)
            {
                rollbackAndClose(existing.connection());
            }

            Connection connection = openConnection(resolved);
            createdNew.set(true);
            deadByFileId.remove(fileId);
            return new FileSessionHandle(resolved.connectionId(), resolved.dialect()
                    .metadata()
                    .id(), stringValue(resolved.properties(), "url"), stringValue(resolved.properties(), "username"), stringValue(resolved.properties(), "password"), connection, now, null);
        });
        return new AcquiredConnection(session.connection(), createdNew.get());
    }

    private String resolveSessionId(String fileId, JdbcConnection resolved, String currentSessionId) throws SQLException
    {
        AcquiredConnection acquired = acquireWithStatus(fileId, resolved);
        if (!acquired.createdNew()
                && !isBlank(currentSessionId))
        {
            return currentSessionId;
        }
        String resolvedSessionId = resolved.dialect()
                .resolveSessionId(acquired.connection());
        if (isBlank(resolvedSessionId))
        {
            return currentSessionId;
        }
        return resolvedSessionId;
    }

    private void rememberSessionId(String fileId, String sessionId)
    {
        if (isBlank(sessionId))
        {
            return;
        }
        byFileId.computeIfPresent(fileId, (_, existing) -> existing.withSessionId(sessionId));
    }

    private void closeFile(String fileId)
    {
        FileSessionHandle removed = byFileId.remove(fileId);
        if (removed != null)
        {
            rollbackAndClose(removed.connection());
            deadByFileId.put(fileId, new DeadSessionSnapshot(fileId, removed.connectionId(), removed.sessionId(), System.currentTimeMillis() + DEFAULT_DEAD_SNAPSHOT_TTL_MS));
        }
    }

    private List<Map<String, Object>> connectionSnapshots(long now)
    {
        List<Map<String, Object>> result = new ArrayList<>();
        byFileId.forEach((fileId, session) ->
        {
            result.add(Map.of("fileId", fileId, "connectionId", session.connectionId(), "sessionId", session.sessionId() == null ? ""
                    : session.sessionId(), "lastAccessTimeMs", session.lastUsedAtMs(), "status", "alive"));
        });
        deadByFileId.forEach((fileId, snapshot) ->
        {
            if (snapshot.expiresAtMs() > now)
            {
                result.add(Map.of("fileId", fileId, "connectionId", snapshot.connectionId(), "sessionId", snapshot.sessionId() == null ? ""
                        : snapshot.sessionId(), "status", "dead"));
            }
        });
        return result;
    }

    private static Connection openConnection(JdbcConnection resolved)
    {
        try
        {
            return resolved.dialect()
                    .openSessionConnection(resolved.properties());
        }
        catch (SQLException e)
        {
            throw new RuntimeException(e);
        }
    }

    private record FileSessionHandle(String connectionId, String dialectId, String url, String username, String password, Connection connection, long lastUsedAtMs, String sessionId)
    {
        FileSessionHandle touch(long now)
        {
            return new FileSessionHandle(connectionId, dialectId, url, username, password, connection, now, sessionId);
        }

        boolean matches(JdbcConnection resolved)
        {
            return Objects.equals(connectionId, resolved.connectionId())
                    && Objects.equals(dialectId, resolved.dialect()
                            .metadata()
                            .id())
                    && Objects.equals(url, stringValue(resolved.properties(), "url"))
                    && Objects.equals(username, stringValue(resolved.properties(), "username"))
                    && Objects.equals(password, stringValue(resolved.properties(), "password"));
        }

        FileSessionHandle withSessionId(String nextSessionId)
        {
            return new FileSessionHandle(connectionId, dialectId, url, username, password, connection, lastUsedAtMs, nextSessionId);
        }
    }

    private record DeadSessionSnapshot(String fileId, String connectionId, String sessionId, long expiresAtMs)
    {
    }

    private record AcquiredConnection(Connection connection, boolean createdNew)
    {
    }
}
