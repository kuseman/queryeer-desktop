package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.parse.ParseResult;

class DefaultIncrementalParseSessionServiceTest
{
    @Test
    void openChangeAndCloseLifecycle()
    {
        DefaultIncrementalParseSessionService service = new DefaultIncrementalParseSessionService();

        service.open("jdbc", "file-1", 0L, "sql", "select 1", (lang, _, _) -> new ParseResult(false, null, Map.of("l", lang)));
        assertTrue(service.get("jdbc", "file-1")
                .isPresent());
        assertEquals(0L, service.get("jdbc", "file-1")
                .orElseThrow()
                .version());

        service.change("jdbc", "file-1", 2L, "sql", "select 2", (_, text, _) -> new ParseResult(true, null, Map.of("t", text)));
        assertEquals(2L, service.get("jdbc", "file-1")
                .orElseThrow()
                .version());
        assertTrue(service.get("jdbc", "file-1")
                .orElseThrow()
                .hasErrors());

        service.close("jdbc", "file-1");
        assertTrue(service.get("jdbc", "file-1")
                .isEmpty());
    }
}
