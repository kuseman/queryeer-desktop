package com.queryeer.backend.queryengine.sql.parser;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.treesitter.TSParser;
import org.treesitter.TSTree;
import org.treesitter.TreeSitterSql;

import com.queryeer.backend.api.PayloadMapper;
import com.queryeer.backend.api.parse.IncrementalParseFunction;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.api.parse.ParseSessionSnapshot;
import com.queryeer.backend.core.JacksonPayloadMapper;

class SqlCompletionSupportTest
{
    private final TSParser parser = new TSParser();

    {
        parser.setLanguage(new TreeSitterSql());
    }

    @SuppressWarnings("unchecked")
    @Test
    void completeHandlesMissingSnapshotWithoutThrowing()
    {
        PayloadMapper payloadMapper = new JacksonPayloadMapper();
        IncrementalParseSessionService parseSessions = new EmptyParseSessionService();
        SqlCompletionSupport.SqlCompletePayload payload = new SqlCompletionSupport.SqlCompletePayload("file-1", 4L, "sel", null, null, new SqlCompletionSupport.SqlCompleteCursor(1, 4), null);

        Object result = assertDoesNotThrow(() -> SqlCompletionSupport.complete(payloadMapper, parseSessions, "jdbc", null, payload));
        Map<String, Object> map = assertInstanceOf(Map.class, result);
        Map<String, Object> context = assertInstanceOf(Map.class, map.get("context"));

        assertEquals("file-1", context.get("fileId"));
        assertEquals(4L, context.get("requestedVersion"));
        assertEquals(null, context.get("snapshotVersion"));
        assertEquals(Boolean.FALSE, context.get("usedFallback"));
        assertInstanceOf(List.class, map.get("items"));
    }

    // -- Alias extraction tests --

    @Test
    void extractAliasesReturnsEmptyForNullTree()
    {
        assertEquals(Map.of(), SqlCompletionSupport.extractAliases(null, "SELECT * FROM t1", 1, 1));
    }

    @Test
    void extractAliasesReturnsEmptyForBlankText()
    {
        TSTree tree = parser.parseString(null, "SELECT * FROM t1");
        assertEquals(Map.of(), SqlCompletionSupport.extractAliases(tree, "", 1, 1));
    }

    @Test
    void extractAliasesWithExplicitAlias()
    {
        TSTree tree = parser.parseString(null, "SELECT * FROM my_table a");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT * FROM my_table a", 1, 1);
        assertEquals(Map.of("a", "my_table"), aliases);
    }

    @Test
    void extractAliasesWithAsKeyword()
    {
        TSTree tree = parser.parseString(null, "SELECT * FROM my_table AS a");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT * FROM my_table AS a", 1, 1);
        assertEquals(Map.of("a", "my_table"), aliases);
    }

    @Test
    void extractAliasesWithImplicitAlias()
    {
        TSTree tree = parser.parseString(null, "SELECT * FROM my_table");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT * FROM my_table", 1, 1);
        assertEquals(Map.of("my_table", "my_table"), aliases);
    }

    @Test
    void extractAliasesWithJoin()
    {
        TSTree tree = parser.parseString(null, "SELECT * FROM t1 a JOIN t2 b ON a.x = b.y");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT * FROM t1 a JOIN t2 b ON a.x = b.y", 1, 1);
        assertEquals(Map.of("a", "t1", "b", "t2"), aliases);
    }

    @Test
    void extractAliasesWithQualifiedTable()
    {
        TSTree tree = parser.parseString(null, "SELECT * FROM dbo.my_table a");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT * FROM dbo.my_table a", 1, 1);
        assertEquals(Map.of("a", "dbo.my_table"), aliases);
    }

    @Test
    void extractAliasesWithDatabaseQualifiedTable()
    {
        String sql = "SELECT * FROM ecomproductsellosprod.dbo.pdvariant v";
        TSTree tree = parser.parseString(null, sql);
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, sql, 1, 1);
        assertEquals(Map.of("v", "ecomproductsellosprod.dbo.pdvariant"), aliases);
    }

    @Test
    void extractAliasesWithMixedExplicitAndImplicit()
    {
        TSTree tree = parser.parseString(null, "SELECT * FROM t1 a, t2");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT * FROM t1 a, t2", 1, 1);
        assertEquals(Map.of("a", "t1", "t2", "t2"), aliases);
    }

    @Test
    void extractAliasesWithPartialSql()
    {
        // Incomplete SQL with an ERROR node — text-based regex fallback should find the alias
        TSTree tree = parser.parseString(null, "SELECT a. FROM t1 a");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT a. FROM t1 a", 1, 1);
        assertEquals(Map.of("a", "t1"), aliases);
    }

    @Test
    void extractAliasesWithCursorInSelectListBeforeFrom()
    {
        String sql = "SELECT na\nFROM public.orders o";
        TSTree tree = parser.parseString(null, sql);
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, sql, 1, 10);
        assertEquals(Map.of("o", "public.orders"), aliases);
    }

    @Test
    void extractAliasesWithInsertTargetColumnList()
    {
        String sql = "INSERT INTO tableB (";
        TSTree tree = parser.parseString(null, sql);
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, sql, 1, 21);
        assertEquals(Map.of("tableb", "tableB"), aliases);
    }

    @Test
    void extractAliasesWithInsertTargetBetweenParentheses()
    {
        String sql = "INSERT INTO public.orders()";
        TSTree tree = parser.parseString(null, sql);
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, sql, 1, 27);
        assertEquals(Map.of("public.orders", "public.orders"), aliases);
    }

    @Test
    void extractAliasesKeywordNotCapturedAsAlias()
    {
        // WHERE should NOT be captured as an alias for my_table
        TSTree tree = parser.parseString(null, "SELECT * FROM my_table WHERE x = 1");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT * FROM my_table WHERE x = 1", 1, 1);
        assertEquals(Map.of("my_table", "my_table"), aliases, "WHERE should not be captured as an alias");
    }

    @Test
    void extractAliasesJoinKeywordNotCapturedAsAlias()
    {
        // ON should NOT be captured as an alias for t2
        TSTree tree = parser.parseString(null, "SELECT * FROM t1 JOIN t2 ON t1.x = t2.y");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT * FROM t1 JOIN t2 ON t1.x = t2.y", 1, 1);
        assertEquals(Map.of("t1", "t1", "t2", "t2"), aliases, "ON should not be captured as an alias");
    }

    @Test
    void extractAliasesGroupByKeywordNotCaptured()
    {
        TSTree tree = parser.parseString(null, "SELECT * FROM my_table GROUP BY name");
        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, "SELECT * FROM my_table GROUP BY name", 1, 1);
        assertEquals(Map.of("my_table", "my_table"), aliases, "GROUP BY should not affect alias extraction");
    }

    @Test
    void extractAliasesScopedByCursorStatement()
    {
        String sql = "SELECT * FROM first_table ft WHERE ft.id = 1\nSELECT s. FROM second_table s";
        TSTree tree = parser.parseString(null, sql);

        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, sql, 2, 9);

        assertEquals(Map.of("s", "second_table"), aliases);
    }

    @Test
    void extractAliasesKeepsOuterAliasInsideExistsSubquery()
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
        TSTree tree = parser.parseString(null, sql);

        Map<String, String> aliases = SqlCompletionSupport.extractAliases(tree, sql, 6, 27);

        assertEquals(Map.of("u", "db1.dbo.users", "du", "db2.dbo.users"), aliases);
    }

    @Test
    void identifierAtPositionReturnsSimpleIdentifier()
    {
        // Cursor on 't1' (column 15)
        String result = SqlCompletionSupport.identifierAtPosition(new EmptyParseSessionService(), "jdbc", "file-1", "SELECT * FROM t1", 1, 15);
        assertEquals("t1", result);
    }

    @Test
    void identifierAtPositionReturnsQualifiedName()
    {
        // Cursor on 't1' part of 'dbo.t1' (column 19 = 't' of t1)
        String result = SqlCompletionSupport.identifierAtPosition(new EmptyParseSessionService(), "jdbc", "file-1", "SELECT * FROM dbo.t1", 1, 19);
        assertEquals("dbo.t1", result);
    }

    @Test
    void identifierAtPositionReturnsQualifiedNameInsideExistsSubquery()
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

        String result = SqlCompletionSupport.identifierAtPosition(new EmptyParseSessionService(), "jdbc", "file-1", sql, 5, 20);

        assertEquals("db2.dbo.users", result);
    }

    @Test
    void identifierAtPositionReturnsNullForWhitespaceCursor()
    {
        // Cursor on the space before t1 (column 14)
        String result = SqlCompletionSupport.identifierAtPosition(new EmptyParseSessionService(), "jdbc", "file-1", "SELECT * FROM t1", 1, 14);
        assertNull(result);
    }

    @Test
    void identifierAtPositionReturnsIdentifierInsideErrorNode()
    {
        // EXEC is T-SQL syntax unknown to tree-sitter-sql, so the whole statement is an
        // ERROR node. The ERROR node's byte range spans the full statement; the old code
        // returned null because isIdentifierText failed on the large span. The fallback
        // raw-text scan must return the correct identifier at the cursor position.
        String sql = "EXEC sp_help 'dbo.Address'";
        // Column 7 lands on 'p' in 'sp_help'
        String result = SqlCompletionSupport.identifierAtPosition(new EmptyParseSessionService(), "jdbc", "file-1", sql, 1, 7);
        assertEquals("sp_help", result);
    }

    @Test
    void identifierAtPositionUsesCachedTreeWhenAvailable()
    {
        String sql = "SELECT * FROM my_table";
        try (TSParser parser = new TSParser())
        {
            parser.setLanguage(new TreeSitterSql());
            TSTree cachedTree = parser.parseString(null, sql);
            ParseSessionSnapshot snapshot = new ParseSessionSnapshot("jdbc", "file-cached", 1L, "sql", false, cachedTree, Map.of());

            IncrementalParseSessionService sessions = new StubParseSessionService(snapshot);

            // Cursor on 'my_table' (column 15)
            String result = SqlCompletionSupport.identifierAtPosition(sessions, "jdbc", "file-cached", sql, 1, 15);
            assertEquals("my_table", result);
        }
    }

    private static final class StubParseSessionService implements IncrementalParseSessionService
    {
        private final ParseSessionSnapshot snapshot;

        StubParseSessionService(ParseSessionSnapshot snapshot)
        {
            this.snapshot = snapshot;
        }

        @Override
        public ParseSessionSnapshot open(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction)
        {
            throw new UnsupportedOperationException();
        }

        @Override
        public ParseSessionSnapshot change(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction)
        {
            throw new UnsupportedOperationException();
        }

        @Override
        public void close(String engineId, String fileId)
        {
            throw new UnsupportedOperationException();
        }

        @Override
        public Optional<ParseSessionSnapshot> get(String engineId, String fileId)
        {
            return Optional.of(snapshot);
        }
    }

    private static final class EmptyParseSessionService implements IncrementalParseSessionService
    {
        @Override
        public ParseSessionSnapshot open(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction)
        {
            throw new UnsupportedOperationException();
        }

        @Override
        public ParseSessionSnapshot change(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction)
        {
            throw new UnsupportedOperationException();
        }

        @Override
        public void close(String engineId, String fileId)
        {
            throw new UnsupportedOperationException();
        }

        @Override
        public Optional<ParseSessionSnapshot> get(String engineId, String fileId)
        {
            return Optional.empty();
        }
    }
}
