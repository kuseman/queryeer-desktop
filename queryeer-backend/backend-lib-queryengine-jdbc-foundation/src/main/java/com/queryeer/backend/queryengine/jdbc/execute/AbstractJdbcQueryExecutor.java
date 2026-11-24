package com.queryeer.backend.queryengine.jdbc.execute;

import static com.queryeer.backend.api.PayloadUtils.isBlank;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.net.URI;
import java.net.URL;
import java.sql.Array;
import java.sql.Blob;
import java.sql.Clob;
import java.sql.Connection;
import java.sql.Ref;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLWarning;
import java.sql.SQLXML;
import java.sql.Statement;
import java.sql.Struct;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.OffsetTime;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.queryeer.backend.queryengine.jdbc.CancellableJdbcQueryExecutor;

/**
 * Base JDBC query executor implementing the full execute/cancel/streaming lifecycle. Subclasses may override these hooks:
 * <ul>
 * <li>{@link #splitStatements(String)} - how to split the incoming SQL into individual batches (default: single statement)</li>
 * <li>{@link #mapColumnValue(Object, String)} - how to coerce a raw column value before publishing (default: identity)</li>
 * </ul>
 */
public abstract class AbstractJdbcQueryExecutor implements CancellableJdbcQueryExecutor
{
    protected final int rowChunkSize;
    private final Map<String, Statement> activeStatements = new ConcurrentHashMap<>();
    /**
     * Executions cancelled while they run. Some drivers ignore {@link Statement#cancel()} while a result is fetched in batches (pgJDBC once it streams), so the row loop and the statement loop also
     * stop on this.
     */
    private final Set<String> cancelledExecutions = ConcurrentHashMap.newKeySet();

    protected AbstractJdbcQueryExecutor()
    {
        this(100);
    }

    protected AbstractJdbcQueryExecutor(int rowChunkSize)
    {
        this.rowChunkSize = Math.max(1, rowChunkSize);
    }

    /**
     * Splits the SQL text into individual statements executed sequentially. Default: a single-element list containing the original SQL string (no splitting).
     */
    protected List<String> splitStatements(String sql)
    {
        return List.of(sql);
    }

    /**
     * A statement from {@link #splitStatements(String)} with the character offset (0-based) where it starts in the original SQL text, or -1 when it could not be located there.
     */
    protected record LocatedStatement(String sql, int offset)
    {
        /** The offset, or null when the statement could not be located. */
        public Integer knownOffset()
        {
            return offset < 0 ? null
                    : offset;
        }
    }

    /**
     * Splits the SQL text with {@link #splitStatements(String)} and locates each statement in the original text, so an error position the database reports relative to a statement can be mapped back
     * to the whole text.
     */
    protected final List<LocatedStatement> splitLocatedStatements(String sql)
    {
        return locateStatements(sql, splitStatements(sql));
    }

    /**
     * Locates each statement in the text. Statements are expected to be (trimmed) slices of the text in order; one that isn't gets offset -1 and doesn't move the search.
     */
    static List<LocatedStatement> locateStatements(String sql, List<String> statements)
    {
        List<LocatedStatement> result = new ArrayList<>(statements.size());
        int searchFrom = 0;
        for (String statement : statements)
        {
            int offset = sql == null
                    || statement == null ? -1
                            : sql.indexOf(statement, searchFrom);
            if (offset >= 0)
            {
                searchFrom = offset + statement.length();
            }
            result.add(new LocatedStatement(statement, offset));
        }
        return result;
    }

    /**
     * Maps a raw column value fetched via {@code ResultSet.getObject()} to the value published to the event listener. Default: return the value unchanged.
     *
     * @param value the raw value from the result set (may be {@code null})
     * @param columnTypeName the JDBC type name in lower case (e.g. {@code "varchar"}, {@code "datetimeoffset"})
     */
    protected Object mapColumnValue(Object value, String columnTypeName)
    {
        return convertJdbcValue(value);
    }

    /**
     * Types that Jackson serialises cleanly without bean introspection. Anything not in this set falls back to {@code toString()} to avoid exposing driver-internal state (e.g. PGObject).
     */
    private static final Set<Class<?>> JACKSON_SAFE_TYPES = Set.of(String.class, Boolean.class, Byte.class, Short.class, Integer.class, Long.class, Float.class, Double.class, BigDecimal.class,
            BigInteger.class, byte[].class, Date.class, LocalDate.class, LocalTime.class, LocalDateTime.class, OffsetDateTime.class, OffsetTime.class, Instant.class, ZonedDateTime.class, UUID.class,
            URI.class, URL.class);

    /**
     * Converts JDBC-specific types that Jackson cannot serialize into plain equivalents. Recurses into container types ({@link Array}, {@link Struct}).
     */
    private static Object convertJdbcValue(Object value)
    {
        if (value == null)
        {
            return null;
        }
        try
        {
            if (value instanceof Array array)
            {
                Object arrayValue = array.getArray();
                if (arrayValue instanceof Object[] objArray)
                {
                    return Arrays.stream(objArray)
                            .map(AbstractJdbcQueryExecutor::convertJdbcValue)
                            .toList();
                }
                return arrayValue;
            }
            if (value instanceof Struct struct)
            {
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("sqlType", struct.getSQLTypeName());
                result.put("attributes", Arrays.stream(struct.getAttributes())
                        .map(AbstractJdbcQueryExecutor::convertJdbcValue)
                        .toList());
                return result;
            }
            if (value instanceof Clob clob)
            {
                long length = clob.length();
                return length > 0L ? clob.getSubString(1L, (int) Math.min(length, Integer.MAX_VALUE))
                        : "";
            }
            if (value instanceof Blob blob)
            {
                long length = blob.length();
                if (length > 0L)
                {
                    return blob.getBytes(1L, (int) Math.min(length, Integer.MAX_VALUE));
                }
                return new byte[0];
            }
            if (value instanceof SQLXML sqlxml)
            {
                return sqlxml.getString();
            }
            if (value instanceof Ref ref)
            {
                Object refValue = ref.getObject();
                return refValue != null ? convertJdbcValue(refValue)
                        : null;
            }
        }
        catch (SQLException e)
        {
            return value.toString();
        }
        // Jackson-safe container types: pass through as-is
        if (value instanceof List
                || value instanceof Map
                || value.getClass()
                        .isArray())
        {
            return value;
        }
        // Jackson-safe leaf types: pass through as-is
        if (JACKSON_SAFE_TYPES.contains(value.getClass()))
        {
            return value;
        }
        // Last resort: toString() for DB-specific types (PGObject, oracle.sql.*, etc.)
        return value.toString();
    }

    @Override
    public final JdbcQueryResult execute(JdbcQueryRequest request, JdbcQueryEventListener eventListener)
    {
        long rowCount = 0L;
        List<LocatedStatement> statements = splitLocatedStatements(request.sql());
        String resolvedDatabase = null;
        String resolvedSessionId = null;

        try
        {
            Connection sessionConnection = request.sessionConnection();
            if (sessionConnection != null)
            {
                applyDatabaseIfRequested(request, sessionConnection);
                rowCount += executeStatements(request, eventListener, statements, sessionConnection);
                forwardWarnings(sessionConnection.getWarnings(), eventListener);
                sessionConnection.clearWarnings();
                resolvedDatabase = resolveCurrentDatabaseIfPossible(request, sessionConnection);
            }
            else
            {
                try (Connection jdbcConnection = request.dialect()
                        .openSessionConnection(effectiveConnectionProperties(request)))
                {
                    applyDatabaseIfRequested(request, jdbcConnection);
                    rowCount += executeStatements(request, eventListener, statements, jdbcConnection);
                    forwardWarnings(jdbcConnection.getWarnings(), eventListener);
                    jdbcConnection.clearWarnings();
                    resolvedDatabase = resolveCurrentDatabaseIfPossible(request, jdbcConnection);
                    resolvedSessionId = resolveSessionIdIfPossible(request, jdbcConnection);
                }
            }
        }
        catch (SQLException e)
        {
            throw new JdbcQueryExecutionException(e.getMessage(), e);
        }
        finally
        {
            activeStatements.remove(request.queryExecutionId());
            cancelledExecutions.remove(request.queryExecutionId());
        }

        Map<String, Object> engineState = new LinkedHashMap<>();
        if (resolvedDatabase != null)
        {
            engineState.put("database", resolvedDatabase);
        }
        if (!isBlank(resolvedSessionId))
        {
            engineState.put("sessionId", resolvedSessionId);
        }
        return new JdbcQueryResult(rowCount, engineState);
    }

    private long executeStatements(JdbcQueryRequest request, JdbcQueryEventListener eventListener, List<LocatedStatement> statements, Connection connection) throws SQLException
    {
        long count = 0L;
        for (LocatedStatement located : statements)
        {
            throwIfCancelled(request.queryExecutionId());
            try (Statement statement = connection.createStatement())
            {
                setFetchSize(statement);
                JdbcStatementScope scope = request.dialect() == null ? JdbcStatementScope.NONE
                        : request.dialect()
                                .beginStatement(connection, statement, located.sql());
                count += runInScope(scope, () -> runStatement(located.sql(), request.queryExecutionId(), eventListener, statement));
            }
            catch (SQLException e)
            {
                throw new JdbcQueryExecutionException(e.getMessage(), e, located.knownOffset());
            }
        }
        return count;
    }

    /**
     * Rows a driver fetches at a time. Without one, some drivers (PostgreSQL's, MySQL's with cursor fetch) read a whole result into memory before returning its first row, which a large result can't
     * fit.
     */
    static final int FETCH_SIZE = 1000;

    private static void setFetchSize(Statement statement)
    {
        try
        {
            statement.setFetchSize(FETCH_SIZE);
        }
        catch (SQLException | UnsupportedOperationException e)
        {
            // A hint; a driver that doesn't support it reads results its own way
        }
    }

    @FunctionalInterface
    private interface StatementRun
    {
        long run() throws SQLException;
    }

    /** Runs the statement, then ends the dialect's scope: with false when the statement failed, keeping the statement's failure as the one thrown. */
    private static long runInScope(JdbcStatementScope scope, StatementRun run) throws SQLException
    {
        long count;
        try
        {
            count = run.run();
        }
        catch (SQLException | RuntimeException | Error e)
        {
            try
            {
                scope.end(false);
            }
            catch (SQLException | RuntimeException endFailure)
            {
                e.addSuppressed(endFailure);
            }
            throw e;
        }
        scope.end(true);
        return count;
    }

    /**
     * Returns connection properties with the target database merged in when the dialect cannot switch databases on an existing connection.
     */
    private static Map<String, Object> effectiveConnectionProperties(JdbcQueryRequest request)
    {
        if (!isBlank(request.database())
                && request.dialect() != null
                && !request.dialect()
                        .canSwitchDatabase())
        {
            Map<String, Object> props = new LinkedHashMap<>(request.connectionProperties());
            props.put("database", request.database());
            return props;
        }
        return request.connectionProperties();
    }

    private void forwardWarnings(SQLWarning warning, JdbcQueryEventListener eventListener)
    {
        while (warning != null)
        {
            eventListener.onOutput(warning.getMessage());
            warning = warning.getNextWarning();
        }
    }

    private static void applyDatabaseIfRequested(JdbcQueryRequest request, Connection connection) throws SQLException
    {
        if (!isBlank(request.database())
                && request.dialect() != null)
        {
            request.dialect()
                    .applyDatabase(connection, request.database());
        }
    }

    private static String resolveCurrentDatabaseIfPossible(JdbcQueryRequest request, Connection connection)
    {
        if (request.dialect() == null)
        {
            return null;
        }
        try
        {
            return request.dialect()
                    .resolveCurrentDatabase(connection);
        }
        catch (SQLException ignored)
        {
            return null;
        }
    }

    private static String resolveSessionIdIfPossible(JdbcQueryRequest request, Connection connection)
    {
        if (request.dialect() == null)
        {
            return null;
        }
        try
        {
            return request.dialect()
                    .resolveSessionId(connection);
        }
        catch (SQLException ignored)
        {
            return null;
        }
    }

    @Override
    public void cancel(String queryExecutionId)
    {
        cancelledExecutions.add(queryExecutionId);
        Statement statement = activeStatements.get(queryExecutionId);
        if (statement == null)
        {
            return;
        }
        try
        {
            statement.cancel();
        }
        catch (SQLException ignored)
        {
        }
    }

    protected final void registerActiveStatement(String queryExecutionId, Statement statement)
    {
        activeStatements.put(queryExecutionId, statement);
    }

    protected final void unregisterActiveStatement(String queryExecutionId, Statement statement)
    {
        activeStatements.remove(queryExecutionId, statement);
    }

    private long runStatement(String sql, String queryExecutionId, JdbcQueryEventListener eventListener, Statement statement) throws SQLException
    {
        registerActiveStatement(queryExecutionId, statement);
        long rowCount = 0L;
        try
        {
            boolean hasResultSet = statement.execute(sql);
            while (true)
            {
                if (hasResultSet)
                {
                    try (ResultSet resultSet = statement.getResultSet())
                    {
                        rowCount += publishResultSet(queryExecutionId, resultSet, eventListener);
                    }
                }
                else
                {
                    int updateCount = statement.getUpdateCount();
                    if (updateCount < 0)
                    {
                        break;
                    }
                    rowCount += Math.max(0, updateCount);
                    eventListener.onOutput(updateCount + " Row(s) affected");
                }

                hasResultSet = statement.getMoreResults();
                if (!hasResultSet
                        && statement.getUpdateCount() < 0)
                {
                    break;
                }
            }
        }
        finally
        {
            try
            {
                forwardWarnings(statement.getWarnings(), eventListener);
                statement.clearWarnings();
            }
            finally
            {
                unregisterActiveStatement(queryExecutionId, statement);
            }
        }
        return rowCount;
    }

    private void throwIfCancelled(String queryExecutionId) throws SQLException
    {
        if (cancelledExecutions.contains(queryExecutionId))
        {
            // SQLSTATE 57014: query_canceled
            throw new SQLException("Query cancelled", "57014");
        }
    }

    private long publishResultSet(String queryExecutionId, ResultSet resultSet, JdbcQueryEventListener eventListener) throws SQLException
    {
        if (resultSet == null)
        {
            return 0L;
        }

        ResultSetMetaData metadata = resultSet.getMetaData();
        int columnCount = metadata.getColumnCount();
        List<JdbcResultColumn> columns = new ArrayList<>(columnCount);
        String[] typeNames = new String[columnCount + 1];
        for (int i = 1; i <= columnCount; i++)
        {
            String typeName = metadata.getColumnTypeName(i);
            typeNames[i] = typeName == null ? "unknown"
                    : typeName.toLowerCase();
            columns.add(new JdbcResultColumn(metadata.getColumnLabel(i), typeNames[i]));
        }
        eventListener.onResultSetStart(columns);

        long rowCount = 0L;
        List<List<Object>> batch = new ArrayList<>(rowChunkSize);
        while (resultSet.next())
        {
            throwIfCancelled(queryExecutionId);
            List<Object> row = new ArrayList<>(columnCount);
            for (int i = 1; i <= columnCount; i++)
            {
                row.add(mapColumnValue(resultSet.getObject(i), typeNames[i]));
            }
            batch.add(row);
            if (batch.size() == rowChunkSize)
            {
                eventListener.onRows(batch);
                rowCount += batch.size();
                batch = new ArrayList<>(rowChunkSize);
            }
        }

        if (!batch.isEmpty())
        {
            eventListener.onRows(batch);
            rowCount += batch.size();
        }
        return rowCount;
    }

    public static final class JdbcQueryExecutionException extends RuntimeException
    {
        private static final long serialVersionUID = 1L;

        private final Integer statementOffset;

        public JdbcQueryExecutionException(String message, Throwable cause)
        {
            this(message, cause, null);
        }

        /**
         * @param statementOffset character offset (0-based) in the executed SQL text where the text the database executed starts, or null when unknown. Error positions the database reports are
         * relative to that text. May be negative when the executed text has a prefix the user didn't write (such as EXPLAIN).
         */
        public JdbcQueryExecutionException(String message, Throwable cause, Integer statementOffset)
        {
            super(message, cause);
            this.statementOffset = statementOffset;
        }

        /** See {@link #JdbcQueryExecutionException(String, Throwable, Integer)}; null when unknown. */
        public Integer statementOffset()
        {
            return statementOffset;
        }
    }
}
