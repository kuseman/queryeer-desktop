package com.queryeer.backend.queryengine.jdbc.sql;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class InMemorySqlParseSessionStoreTest
{
    @Test
    void openChangeAndCloseLifecycle()
    {
        InMemorySqlParseSessionStore store = new InMemorySqlParseSessionStore();
        store.open("file-1", "postgres", "select 1");

        SqlParseSession opened = store.get("file-1")
                .orElseThrow();
        assertEquals(0L, opened.version());
        assertEquals("postgres", opened.grammarId());

        store.change("file-1", 5L, "select 2");
        SqlParseSession changed = store.get("file-1")
                .orElseThrow();
        assertEquals(5L, changed.version());
        assertEquals("select 2", changed.text());

        store.close("file-1");
        assertTrue(store.get("file-1")
                .isEmpty());
    }
}
