package com.queryeer.backend.queryengine.sql.parser;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;

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
