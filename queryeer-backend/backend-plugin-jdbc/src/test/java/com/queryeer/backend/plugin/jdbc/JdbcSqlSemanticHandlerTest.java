package com.queryeer.backend.plugin.jdbc;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaNavigator;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.sql.parser.SqlHoverSupport;
import com.queryeer.backend.queryengine.sql.parser.SqlParseContext;

class JdbcSqlSemanticHandlerTest
{
    private JdbcSchemaNavigator schemaNavigator;
    private JdbcSqlSemanticHandler handler;

    private static final String CONN_ID = "conn-1";

    @BeforeEach
    void setUp()
    {
        schemaNavigator = mock(JdbcSchemaNavigator.class);
        when(schemaNavigator.loadDeepSnapshot(CONN_ID)).thenReturn(buildMultiDbSnapshot());

        handler = new JdbcSqlSemanticHandler(mock(PayloadMapper.class), mock(IncrementalParseSessionService.class), "test-engine", schemaNavigator, mock(JdbcConnectionUsageListener.class),
                Function.identity());
    }

    @Test
    void tableHover_respectsSelectedDb_whenTableExistsInMultipleDatabases()
    {
        // When db1 is selected, should find db1.users (with PK on id)
        Map<String, Object> result = invokeTableHover(CONN_ID, "db1", "users");
        assertNotNull(result);
        String markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Table: users");
        assertContains(markdown, "PK"); // only db1's users has PK

        // When db2 is selected, should find db2.users (no PK, has email)
        result = invokeTableHover(CONN_ID, "db2", "users");
        assertNotNull(result);
        markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Table: users");
        assertContains(markdown, "email"); // only db2's users has email
    }

    @Test
    void tableHover_returnsNull_whenTableNotInSelectedDb()
    {
        // orders only exists in db1
        Map<String, Object> result = invokeTableHover(CONN_ID, "db2", "orders");
        assertNull(result);
    }

    @Test
    void tableHover_returnsMatch_whenNoDatabaseFilter()
    {
        // When no database is selected, find the first match (db1, first in list)
        Map<String, Object> result = invokeTableHover(CONN_ID, null, "users");
        assertNotNull(result);
        String markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Table: users");
        assertContains(markdown, "PK"); // first match is db1's users
    }

    @Test
    void columnHover_respectsSelectedDb_whenColumnExistsInMultipleDatabases()
    {
        // id column exists in both db1.users and db2.users
        // When db1 selected, should find db1.users.id (with PK)
        Map<String, Object> result = invokeColumnHover(CONN_ID, "db1", "id");
        assertNotNull(result);
        String markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Column: users.id");
        assertContains(markdown, "Primary Key: Yes"); // only db1's id is PK

        // When db2 selected, should find db2.users.id (no PK)
        result = invokeColumnHover(CONN_ID, "db2", "id");
        assertNotNull(result);
        String markdown2 = extractMarkdown(result);
        assertNotNull(markdown2);
        assertContains(markdown2, "Column: users.id");
    }

    @Test
    void columnHover_returnsNull_whenColumnNotInSelectedDb()
    {
        // email only exists in db2.users
        Map<String, Object> result = invokeColumnHover(CONN_ID, "db1", "email");
        assertNull(result);
    }

    // -- Helpers --

    private Map<String, Object> invokeTableHover(String connectionId, String database, String token)
    {
        return handler.semanticHover(new SqlHoverSupport.SqlHoverPayload("file1", null, new SqlHoverSupport.SqlHoverCursor(1, 1), connectionId, database), "file1",
                new SqlHoverSupport.SqlHoverCursor(1, 1), token, SqlParseContext.TABLE_REFERENCE, Map.of());
    }

    private Map<String, Object> invokeColumnHover(String connectionId, String database, String token)
    {
        return handler.semanticHover(new SqlHoverSupport.SqlHoverPayload("file1", null, new SqlHoverSupport.SqlHoverCursor(1, 1), connectionId, database), "file1",
                new SqlHoverSupport.SqlHoverCursor(1, 1), token, SqlParseContext.COLUMN_REFERENCE, Map.of());
    }

    private static String extractMarkdown(Map<String, Object> result)
    {
        if (result == null)
        {
            return null;
        }
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> contents = (List<Map<String, Object>>) result.get("contents");
        if (contents == null
                || contents.isEmpty())
        {
            return null;
        }
        Object value = contents.getFirst()
                .get("value");
        return value instanceof String s ? s
                : null;
    }

    private static void assertContains(String text, String substring)
    {
        if (!text.contains(substring))
        {
            throw new AssertionError("Expected text to contain: " + substring + " but was: " + text);
        }
    }

    private static List<JdbcSchemaObject> buildMultiDbSnapshot()
    {
        // Build: db1.dbo.users (id PK, name), db2.dbo.users (id, email), db1.sales.orders (id, total)
        JdbcSchemaObject usersIdDb1 = new JdbcSchemaObject("col:id", "id", "column", null, Map.of("type", "INTEGER", "nullable", false, "primaryKey", true));
        JdbcSchemaObject usersName = new JdbcSchemaObject("col:name", "name", "column", null, Map.of("type", "VARCHAR", "nullable", true));
        JdbcSchemaObject db1Users = new JdbcSchemaObject("table:users_db1", "users", "table", List.of(usersIdDb1, usersName), Map.of());

        JdbcSchemaObject usersIdDb2 = new JdbcSchemaObject("col:id2", "id", "column", null, Map.of("type", "INTEGER", "nullable", false));
        JdbcSchemaObject usersEmail = new JdbcSchemaObject("col:email", "email", "column", null, Map.of("type", "VARCHAR", "nullable", true));
        JdbcSchemaObject db2Users = new JdbcSchemaObject("table:users_db2", "users", "table", List.of(usersIdDb2, usersEmail), Map.of());

        JdbcSchemaObject ordersId = new JdbcSchemaObject("col:oid", "id", "column", null, Map.of("type", "INTEGER", "nullable", false));
        JdbcSchemaObject ordersTotal = new JdbcSchemaObject("col:total", "total", "column", null, Map.of("type", "DECIMAL", "nullable", true));
        JdbcSchemaObject db1Orders = new JdbcSchemaObject("table:orders", "orders", "table", List.of(ordersId, ordersTotal), Map.of());

        JdbcSchemaObject db1Schema = new JdbcSchemaObject("schema:dbo_db1", "dbo", "schema", List.of(db1Users), null);
        JdbcSchemaObject db1 = new JdbcSchemaObject("db:db1", "db1", "database", List.of(db1Schema), null);

        JdbcSchemaObject db2Schema = new JdbcSchemaObject("schema:dbo_db2", "dbo", "schema", List.of(db2Users), null);
        JdbcSchemaObject db2 = new JdbcSchemaObject("db:db2", "db2", "database", List.of(db2Schema), null);

        JdbcSchemaObject salesSchema = new JdbcSchemaObject("schema:sales", "sales", "schema", List.of(db1Orders), null);
        JdbcSchemaObject db1WithSales = new JdbcSchemaObject("db:db1_v2", "db1", "database", List.of(salesSchema), null);

        return List.of(db1, db2, db1WithSales);
    }
}
