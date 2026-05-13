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

class SqlCompletionSupportTest
{
    @SuppressWarnings("unchecked")
    @Test
    void completeHandlesMissingSnapshotWithoutThrowing()
    {
        PayloadMapper payloadMapper = new PassthroughPayloadMapper();
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
        TSParser parser = new TSParser();
        parser.setLanguage(new TreeSitterSql());
        TSTree cachedTree = parser.parseString(null, sql);
        ParseSessionSnapshot snapshot = new ParseSessionSnapshot("jdbc", "file-cached", 1L, "sql", false, cachedTree, Map.of());

        IncrementalParseSessionService sessions = new StubParseSessionService(snapshot);

        // Cursor on 'my_table' (column 15)
        String result = SqlCompletionSupport.identifierAtPosition(sessions, "jdbc", "file-cached", sql, 1, 15);
        assertEquals("my_table", result);
    }

    private static final class PassthroughPayloadMapper implements PayloadMapper
    {
        @Override
        public <T> T convert(Object fromValue, Class<T> toValueType)
        {
            return toValueType.cast(fromValue);
        }

        @Override
        public <T> List<T> convertToList(Object fromValue, Class<T> toValueType)
        {
            throw new UnsupportedOperationException();
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
