package com.queryeer.backend.core;

import java.net.URI;
import java.util.Optional;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.api.FileSessionHandler;

class DefaultFileRegistryTest
{
    @Test
    void rebindWithChangedConnectionClosesPreviousAndOpensNewSession()
    {
        DefaultFileRegistry registry = new DefaultFileRegistry();
        RecordingHandler handler = new RecordingHandler();
        registry.register(handler);

        registry.open("file-1", URI.create("file:///query.sql"), "text/sql", "jdbc", "conn-a", "select 1");
        Optional<FileSession> rebound = registry.bind("file-1", "jdbc", "conn-b");

        Assertions.assertTrue(rebound.isPresent());
        Assertions.assertEquals(2, handler.opens);
        Assertions.assertEquals(1, handler.closes);
        Assertions.assertEquals("conn-a", handler.lastClosedConnectionId);
        Assertions.assertEquals("conn-b", handler.lastOpenedConnectionId);
    }

    @Test
    void rebindWithSameBindingDoesNotCloseOrReopenSession()
    {
        DefaultFileRegistry registry = new DefaultFileRegistry();
        RecordingHandler handler = new RecordingHandler();
        registry.register(handler);

        registry.open("file-1", URI.create("file:///query.sql"), "text/sql", "jdbc", "conn-a", "select 1");
        Optional<FileSession> rebound = registry.bind("file-1", "jdbc", "conn-a");

        Assertions.assertTrue(rebound.isPresent());
        Assertions.assertEquals(1, handler.opens);
        Assertions.assertEquals(0, handler.closes);
    }

    private static final class RecordingHandler implements FileSessionHandler
    {
        private int opens;
        private int closes;
        private String lastClosedConnectionId;
        private String lastOpenedConnectionId;

        @Override
        public String engineId()
        {
            return "jdbc";
        }

        @Override
        public void onOpen(FileSession session, String initialText)
        {
            opens++;
            lastOpenedConnectionId = session.connectionId();
        }

        @Override
        public void onClose(FileSession session)
        {
            closes++;
            lastClosedConnectionId = session.connectionId();
        }
    }
}
