package com.queryeer.backend.plugin.jdbc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.function.Function;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.core.JacksonPayloadMapper;
import com.queryeer.backend.plugin.jdbc.schema.JdbcSchemaNavigator;
import com.queryeer.backend.queryengine.jdbc.schema.JdbcSchemaObject;
import com.queryeer.backend.queryengine.sql.parser.SqlCompletionSupport;
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
        List<JdbcSchemaObject> snapshot = buildMultiDbSnapshot();
        when(schemaNavigator.tableDetail(eq(CONN_ID), anyString(), nullable(String.class)))
                .thenAnswer(invocation -> findObjectDetail(snapshot, invocation.getArgument(1), invocation.getArgument(2), "table", "view", "base table"));
        when(schemaNavigator.procedureDetail(eq(CONN_ID), anyString(), nullable(String.class)))
                .thenAnswer(invocation -> findObjectDetail(snapshot, invocation.getArgument(1), invocation.getArgument(2), "procedure"));
        when(schemaNavigator.columnDetail(eq(CONN_ID), anyString(), nullable(String.class))).thenAnswer(invocation -> findColumnDetail(snapshot, invocation.getArgument(1), invocation.getArgument(2)));

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
        assertContains(markdown, "Table: db1.dbo.users");
        assertContains(markdown, "PK"); // only db1's users has PK

        // When db2 is selected, should find db2.users (no PK, has email)
        result = invokeTableHover(CONN_ID, "db2", "users");
        assertNotNull(result);
        markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Table: db2.dbo.Users");
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
        assertContains(markdown, "Table: db1.dbo.users");
        assertContains(markdown, "PK"); // first match is db1's users
    }

    @Test
    void tableHover_honorsExplicitDatabaseQualifier()
    {
        Map<String, Object> result = invokeTableHover(CONN_ID, "db1", "db2.dbo.users");

        assertNotNull(result);
        String markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Table: db2.dbo.Users");
        assertContains(markdown, "email");
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
        assertContains(markdown, "Column: db1.dbo.users.id");
        assertContains(markdown, "Primary Key: Yes"); // only db1's id is PK

        // When db2 selected, should find db2.users.id (no PK)
        result = invokeColumnHover(CONN_ID, "db2", "id");
        assertNotNull(result);
        String markdown2 = extractMarkdown(result);
        assertNotNull(markdown2);
        assertContains(markdown2, "Column: db2.dbo.Users.id");
    }

    @Test
    void columnHover_returnsNull_whenColumnNotInSelectedDb()
    {
        // email only exists in db2.users
        Map<String, Object> result = invokeColumnHover(CONN_ID, "db1", "email");
        assertNull(result);
    }

    @Test
    void columnHover_honorsExplicitDatabaseQualifier()
    {
        Map<String, Object> result = invokeColumnHover(CONN_ID, "db1", "db2.dbo.users.email");

        assertNotNull(result);
        String markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Column: db2.dbo.Users.email");
        assertContains(markdown, "VARCHAR");
    }

    @Test
    void hoverSupport_doesNotResolveUnqualifiedColumnFromUnresolvedTable()
    {
        String sql = """
                select *
                from table_that_not_exists
                where externalId = '1234'
                """;
        SqlHoverSupport.SqlHoverPayload payload = new SqlHoverSupport.SqlHoverPayload("file1", sql, new SqlHoverSupport.SqlHoverCursor(3, 9), CONN_ID, "db1", null);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) SqlHoverSupport.hover(new JacksonPayloadMapper(), mock(IncrementalParseSessionService.class), "test-engine", "file1", payload,
                handler::semanticHover);

        assertNull(result);
    }

    @Test
    void hoverSupport_resolvesAliasInsideExistsSubquery()
    {
        String sql = """
                SELECT *
                FROM db1.dbo.users u
                WHERE EXISTS (
                    SELECT 1
                    FROM db2.dbo.users du
                    WHERE du.email = u.name
                )
                """;
        SqlHoverSupport.SqlHoverPayload payload = new SqlHoverSupport.SqlHoverPayload("file1", sql, new SqlHoverSupport.SqlHoverCursor(6, 17), CONN_ID, "db1", null);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) SqlHoverSupport.hover(new JacksonPayloadMapper(), mock(IncrementalParseSessionService.class), "test-engine", "file1", payload,
                handler::semanticHover);

        assertNotNull(result);
        String markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Column: db2.dbo.Users.email");
        assertContains(markdown, "VARCHAR");
    }

    @Test
    void hoverSupport_resolvesOuterAliasInsideExistsSubquery()
    {
        String sql = """
                SELECT *
                FROM db1.dbo.users u
                WHERE EXISTS (
                    SELECT 1
                    FROM db2.dbo.users du
                    WHERE du.email = u.name
                )
                """;
        SqlHoverSupport.SqlHoverPayload payload = new SqlHoverSupport.SqlHoverPayload("file1", sql, new SqlHoverSupport.SqlHoverCursor(6, 27), CONN_ID, "db1", null);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) SqlHoverSupport.hover(new JacksonPayloadMapper(), mock(IncrementalParseSessionService.class), "test-engine", "file1", payload,
                handler::semanticHover);

        assertNotNull(result);
        String markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Column: db1.dbo.users.name");
        assertContains(markdown, "VARCHAR");
    }

    @Test
    void hoverSupport_resolvesTableInsideExistsSubquery()
    {
        String sql = """
                SELECT *
                FROM db1.dbo.users u
                WHERE EXISTS (
                    SELECT 1
                    FROM db2.dbo.users du
                    WHERE du.email = u.name
                )
                """;
        SqlHoverSupport.SqlHoverPayload payload = new SqlHoverSupport.SqlHoverPayload("file1", sql, new SqlHoverSupport.SqlHoverCursor(5, 20), CONN_ID, "db1", null);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) SqlHoverSupport.hover(new JacksonPayloadMapper(), mock(IncrementalParseSessionService.class), "test-engine", "file1", payload,
                handler::semanticHover);

        assertNotNull(result);
        String markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Table: db2.dbo.Users");
        assertContains(markdown, "email");
    }

    @Test
    void hoverSupport_resolvesTableAliasInsideExistsSubquery()
    {
        String sql = """
                SELECT *
                FROM db1.dbo.users u
                WHERE EXISTS (
                    SELECT 1
                    FROM db2.dbo.users du
                    WHERE du.email = u.name
                )
                """;
        SqlHoverSupport.SqlHoverPayload payload = new SqlHoverSupport.SqlHoverPayload("file1", sql, new SqlHoverSupport.SqlHoverCursor(5, 26), CONN_ID, "db1", null);

        @SuppressWarnings("unchecked")
        Map<String, Object> result = (Map<String, Object>) SqlHoverSupport.hover(new JacksonPayloadMapper(), mock(IncrementalParseSessionService.class), "test-engine", "file1", payload,
                handler::semanticHover);

        assertNotNull(result);
        String markdown = extractMarkdown(result);
        assertNotNull(markdown);
        assertContains(markdown, "Table: db2.dbo.Users");
        assertContains(markdown, "email");
    }

    @Test
    void extractProcedureNameBeforeCursor_returnsNull_whenOnlyExecKeyword()
    {
        assertNull(JdbcSqlSemanticHandler.extractProcedureNameBeforeCursor("EXEC ", new SqlCompletionSupport.SqlCompleteCursor(1, 6)));
    }

    @Test
    void extractProcedureNameBeforeCursor_returnsNull_whenCursorOnProcedureName()
    {
        assertNull(JdbcSqlSemanticHandler.extractProcedureNameBeforeCursor("EXEC my_proc", new SqlCompletionSupport.SqlCompleteCursor(1, 14)));
    }

    @Test
    void extractProcedureNameBeforeCursor_returnsNull_whenCursorOnQualifiedName()
    {
        assertNull(JdbcSqlSemanticHandler.extractProcedureNameBeforeCursor("EXEC dbo.my_proc", new SqlCompletionSupport.SqlCompleteCursor(1, 18)));
    }

    @Test
    void extractProcedureNameBeforeCursor_returnsName_whenCursorPastNameWithSpace()
    {
        assertEquals("dbo.my_proc", JdbcSqlSemanticHandler.extractProcedureNameBeforeCursor("EXEC dbo.my_proc ", new SqlCompletionSupport.SqlCompleteCursor(1, 19)));
    }

    @Test
    void extractProcedureNameBeforeCursor_returnsName_whenCursorPastNameWithParen()
    {
        assertEquals("dbo.my_proc", JdbcSqlSemanticHandler.extractProcedureNameBeforeCursor("EXEC dbo.my_proc(", new SqlCompletionSupport.SqlCompleteCursor(1, 19)));
    }

    @Test
    void extractProcedureNameBeforeCursor_handlesCallKeyword()
    {
        assertEquals("my_proc", JdbcSqlSemanticHandler.extractProcedureNameBeforeCursor("CALL my_proc ", new SqlCompletionSupport.SqlCompleteCursor(1, 14)));
    }

    @Test
    void extractProcedureNameBeforeCursor_returnsNull_whenNoKeyword()
    {
        assertNull(JdbcSqlSemanticHandler.extractProcedureNameBeforeCursor("SELECT * FROM ", new SqlCompletionSupport.SqlCompleteCursor(1, 15)));
    }

    // -- Helpers --

    private Map<String, Object> invokeTableHover(String connectionId, String database, String token)
    {
        return handler.semanticHover(new SqlHoverSupport.SqlHoverPayload("file1", null, new SqlHoverSupport.SqlHoverCursor(1, 1), connectionId, database, null), "file1",
                new SqlHoverSupport.SqlHoverCursor(1, 1), token, SqlParseContext.TABLE_REFERENCE, Map.of());
    }

    private Map<String, Object> invokeColumnHover(String connectionId, String database, String token)
    {
        return handler.semanticHover(new SqlHoverSupport.SqlHoverPayload("file1", null, new SqlHoverSupport.SqlHoverCursor(1, 1), connectionId, database, null), "file1",
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
        JdbcSchemaObject db2UsersColumns = new JdbcSchemaObject("columns_folder:users_db2", "Columns", "columns_folder", List.of(usersIdDb2, usersEmail), Map.of());
        JdbcSchemaObject db2Users = new JdbcSchemaObject("table:users_db2", "Users", "table", List.of(db2UsersColumns), Map.of());

        JdbcSchemaObject ordersId = new JdbcSchemaObject("col:oid", "id", "column", null, Map.of("type", "INTEGER", "nullable", false));
        JdbcSchemaObject ordersTotal = new JdbcSchemaObject("col:total", "total", "column", null, Map.of("type", "DECIMAL", "nullable", true));
        JdbcSchemaObject ordersExternalId = new JdbcSchemaObject("col:externalId", "externalId", "column", null, Map.of("type", "VARCHAR", "nullable", true));
        JdbcSchemaObject db1Orders = new JdbcSchemaObject("table:orders", "orders", "table", List.of(ordersId, ordersTotal, ordersExternalId), Map.of());

        JdbcSchemaObject db1Schema = new JdbcSchemaObject("schema:dbo_db1", "dbo", "schema", List.of(db1Users), null);
        JdbcSchemaObject db1 = new JdbcSchemaObject("db:db1", "db1", "database", List.of(db1Schema), null);

        JdbcSchemaObject db2Schema = new JdbcSchemaObject("schema:dbo_db2", "dbo", "schema", List.of(db2Users), null);
        JdbcSchemaObject db2 = new JdbcSchemaObject("db:db2", "db2", "database", List.of(db2Schema), null);

        JdbcSchemaObject salesSchema = new JdbcSchemaObject("schema:sales", "sales", "schema", List.of(db1Orders), null);
        JdbcSchemaObject db1WithSales = new JdbcSchemaObject("db:db1_v2", "db1", "database", List.of(salesSchema), null);

        return List.of(db1, db2, db1WithSales);
    }

    private static JdbcSchemaNavigator.ObjectDetail findObjectDetail(List<JdbcSchemaObject> snapshot, String rawName, String selectedDatabase, String... kinds)
    {
        Lookup lookup = parseLookup(rawName);
        if (lookup.name() == null)
        {
            return null;
        }
        String database = lookup.database() != null ? lookup.database()
                : JdbcUtils.normalizeIdentifier(selectedDatabase);
        return findObjectDetail(snapshot, new Path(null, null), lookup.name(), lookup.schema(), database, List.of(kinds));
    }

    private static JdbcSchemaNavigator.ObjectDetail findObjectDetail(List<JdbcSchemaObject> nodes, Path path, String name, String schema, String database, List<String> kinds)
    {
        for (JdbcSchemaObject node : nodes)
        {
            String kind = node.kind();
            Path nextPath = path;
            if ("database".equalsIgnoreCase(kind))
            {
                nextPath = new Path(node.name(), path.schema());
            }
            else if ("schema".equalsIgnoreCase(kind))
            {
                nextPath = new Path(path.database(), node.name());
            }
            if (kinds.stream()
                    .anyMatch(k -> k.equalsIgnoreCase(kind))
                    && node.name() != null
                    && node.name()
                            .equalsIgnoreCase(name))
            {
                if (database != null
                        && nextPath.database() != null
                        && !database.equals(JdbcUtils.normalizeIdentifier(nextPath.database())))
                {
                    // Keep searching.
                }
                else if (schema != null
                        && nextPath.schema() != null
                        && !schema.equals(JdbcUtils.normalizeIdentifier(nextPath.schema())))
                {
                    // Keep searching.
                }
                else
                {
                    return new JdbcSchemaNavigator.ObjectDetail(node, nextPath.database(), nextPath.schema());
                }
            }
            if (node.children() != null)
            {
                JdbcSchemaNavigator.ObjectDetail found = findObjectDetail(node.children(), nextPath, name, schema, database, kinds);
                if (found != null)
                {
                    return found;
                }
            }
        }
        return null;
    }

    private static JdbcSchemaNavigator.ColumnDetail findColumnDetail(List<JdbcSchemaObject> snapshot, String columnName, String selectedDatabase)
    {
        String normalizedColumn = JdbcUtils.normalizeIdentifier(columnName);
        String normalizedDatabase = JdbcUtils.normalizeIdentifier(selectedDatabase);
        return findColumnDetail(snapshot, new Path(null, null), normalizedColumn, normalizedDatabase);
    }

    private static JdbcSchemaNavigator.ColumnDetail findColumnDetail(List<JdbcSchemaObject> nodes, Path path, String columnName, String database)
    {
        for (JdbcSchemaObject node : nodes)
        {
            String kind = node.kind();
            Path nextPath = path;
            if ("database".equalsIgnoreCase(kind))
            {
                nextPath = new Path(node.name(), path.schema());
            }
            else if ("schema".equalsIgnoreCase(kind))
            {
                nextPath = new Path(path.database(), node.name());
            }
            if (("table".equalsIgnoreCase(kind)
                    || "view".equalsIgnoreCase(kind))
                    && (database == null
                            || nextPath.database() == null
                            || database.equals(JdbcUtils.normalizeIdentifier(nextPath.database()))))
            {
                for (JdbcSchemaObject column : columns(node))
                {
                    if (column.name() != null
                            && JdbcUtils.normalizeIdentifier(column.name())
                                    .equals(columnName))
                    {
                        return new JdbcSchemaNavigator.ColumnDetail(column, node.name(), kind, nextPath.database(), nextPath.schema());
                    }
                }
            }
            if (node.children() != null)
            {
                JdbcSchemaNavigator.ColumnDetail found = findColumnDetail(node.children(), nextPath, columnName, database);
                if (found != null)
                {
                    return found;
                }
            }
        }
        return null;
    }

    private static List<JdbcSchemaObject> columns(JdbcSchemaObject table)
    {
        if (table.children() == null)
        {
            return List.of();
        }
        java.util.ArrayList<JdbcSchemaObject> result = new java.util.ArrayList<>();
        for (JdbcSchemaObject child : table.children())
        {
            if ("column".equalsIgnoreCase(child.kind()))
            {
                result.add(child);
            }
            else if ("columns_folder".equalsIgnoreCase(child.kind())
                    && child.children() != null)
            {
                result.addAll(columns(child));
            }
        }
        return result;
    }

    private static Lookup parseLookup(String value)
    {
        String normalized = JdbcUtils.normalizeIdentifier(value);
        if (normalized == null)
        {
            return new Lookup(null, null, null);
        }
        String[] parts = normalized.split("\\.");
        if (parts.length >= 3)
        {
            return new Lookup(parts[parts.length - 3], parts[parts.length - 2], parts[parts.length - 1]);
        }
        if (parts.length == 2)
        {
            return new Lookup(null, parts[0], parts[1]);
        }
        return new Lookup(null, null, parts[0]);
    }

    private record Lookup(String database, String schema, String name)
    {
    }

    private record Path(String database, String schema)
    {
    }
}
