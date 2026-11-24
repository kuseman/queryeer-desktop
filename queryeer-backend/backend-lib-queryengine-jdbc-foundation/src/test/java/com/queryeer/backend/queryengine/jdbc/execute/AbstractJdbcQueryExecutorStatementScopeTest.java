package com.queryeer.backend.queryengine.jdbc.execute;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.queryengine.jdbc.JdbcDialect;
import com.queryeer.backend.queryengine.jdbc.JdbcDialectMetadata;

class AbstractJdbcQueryExecutorStatementScopeTest
{
    private final AbstractJdbcQueryExecutor executor = new AbstractJdbcQueryExecutor()
    {
        @Override
        protected List<String> splitStatements(String sql)
        {
            return List.of(sql.split(";"));
        }
    };

    private Connection connection;

    @BeforeEach
    void open() throws SQLException
    {
        connection = DriverManager.getConnection("jdbc:h2:mem:");
    }

    @AfterEach
    void close() throws SQLException
    {
        connection.close();
    }

    @Test
    void eachStatementRunsInTheDialectsScopeWithAFetchSize()
    {
        RecordingDialect dialect = new RecordingDialect(null);

        JdbcQueryResult result = executor.execute(request("select 1;select 2", dialect), new NoopListener());

        assertEquals(2L, result.rowCount());
        assertEquals(List.of("begin select 1 fetch=1000", "end true", "begin select 2 fetch=1000", "end true"), dialect.events);
    }

    @Test
    void aFailedStatementEndsItsScopeUnsuccessfullyAndStopsTheQuery()
    {
        RecordingDialect dialect = new RecordingDialect(null);

        JdbcQueryRequest request = request("select 1;select * from no_such_table;select 3", dialect);
        assertThrows(AbstractJdbcQueryExecutor.JdbcQueryExecutionException.class, () -> executor.execute(request, new NoopListener()));

        assertEquals(List.of("begin select 1 fetch=1000", "end true", "begin select * from no_such_table fetch=1000", "end false"), dialect.events);
    }

    @Test
    void theStatementsFailureWinsOverTheScopes()
    {
        SQLException endFailure = new SQLException("end failed");
        RecordingDialect dialect = new RecordingDialect(endFailure);

        AbstractJdbcQueryExecutor.JdbcQueryExecutionException thrown = assertThrows(AbstractJdbcQueryExecutor.JdbcQueryExecutionException.class,
                () -> executor.execute(request("select * from no_such_table", dialect), new NoopListener()));

        assertTrue(thrown.getMessage()
                .contains("NO_SUCH_TABLE"), thrown.getMessage());
        assertSame(endFailure, thrown.getCause()
                .getSuppressed()[0]);
    }

    @Test
    void aScopeThatFailsToEndFailsTheQuery()
    {
        RecordingDialect dialect = new RecordingDialect(new SQLException("commit failed"));

        AbstractJdbcQueryExecutor.JdbcQueryExecutionException thrown = assertThrows(AbstractJdbcQueryExecutor.JdbcQueryExecutionException.class,
                () -> executor.execute(request("select 1", dialect), new NoopListener()));

        assertEquals("commit failed", thrown.getMessage());
    }

    @Test
    void aCancelledQueryStopsReadingRowsAndEndsItsScopeUnsuccessfully()
    {
        RecordingDialect dialect = new RecordingDialect(null);
        List<Integer> chunks = new ArrayList<>();
        JdbcQueryEventListener cancelOnFirstRows = new NoopListener()
        {
            @Override
            public void onRows(List<List<Object>> rows)
            {
                chunks.add(rows.size());
                executor.cancel("q1");
            }
        };

        JdbcQueryRequest request = request("select x from system_range(1, 100000)", dialect);
        AbstractJdbcQueryExecutor.JdbcQueryExecutionException thrown = assertThrows(AbstractJdbcQueryExecutor.JdbcQueryExecutionException.class, () -> executor.execute(request, cancelOnFirstRows));

        assertEquals("57014", ((SQLException) thrown.getCause()).getSQLState());
        assertEquals(List.of(100), chunks);
        assertEquals(List.of("begin select x from system_range(1, 100000) fetch=1000", "end false"), dialect.events);
        // The cancellation ends with its execution: the id can run again
        assertEquals(3L, executor.execute(request("select x from system_range(1, 3)", dialect), new NoopListener())
                .rowCount());
    }

    @Test
    void aFailingListenerEndsTheScopeUnsuccessfully()
    {
        RecordingDialect dialect = new RecordingDialect(null);
        IllegalStateException transportFailure = new IllegalStateException("transport closed");
        JdbcQueryEventListener failing = new NoopListener()
        {
            @Override
            public void onRows(List<List<Object>> rows)
            {
                throw transportFailure;
            }
        };

        IllegalStateException thrown = assertThrows(IllegalStateException.class, () -> executor.execute(request("select 1", dialect), failing));

        assertSame(transportFailure, thrown);
        assertEquals(List.of("begin select 1 fetch=1000", "end false"), dialect.events);
    }

    @Test
    void runsWithoutADialect()
    {
        assertEquals(1L, executor.execute(request("select 1", null), new NoopListener())
                .rowCount());
    }

    private JdbcQueryRequest request(String sql, JdbcDialect dialect)
    {
        return new JdbcQueryRequest("q1", "file", sql, "connection", Map.of(), connection, null, dialect, null);
    }

    /** Records each statement's scope; its end throws {@code endFailure} when set. */
    private static final class RecordingDialect implements JdbcDialect
    {
        private final List<String> events = new ArrayList<>();
        private final SQLException endFailure;

        RecordingDialect(SQLException endFailure)
        {
            this.endFailure = endFailure;
        }

        @Override
        public JdbcStatementScope beginStatement(Connection connection, Statement statement, String sql) throws SQLException
        {
            events.add("begin " + sql + " fetch=" + statement.getFetchSize());
            return succeeded ->
            {
                events.add("end " + succeeded);
                if (endFailure != null)
                {
                    throw endFailure;
                }
            };
        }

        @Override
        public JdbcDialectMetadata metadata()
        {
            return new JdbcDialectMetadata("test", "Test", null, "jdbc:h2:mem:", "org.h2.Driver");
        }

        @Override
        public JdbcQueryExecutor queryExecutor()
        {
            throw new UnsupportedOperationException();
        }

        @Override
        public String buildUrl(Map<String, Object> materializedProperties)
        {
            return "jdbc:h2:mem:";
        }
    }

    private static class NoopListener implements JdbcQueryEventListener
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
