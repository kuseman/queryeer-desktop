package com.queryeer.backend.core;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

import com.queryeer.backend.api.FileRegistry;
import com.queryeer.backend.api.FileSession;
import com.queryeer.backend.api.FileSessionHandler;
import com.queryeer.backend.api.FileSessionHandlerRegistry;

public final class DefaultFileRegistry implements FileRegistry, FileSessionHandlerRegistry
{
    private final Map<String, FileSessionHandler> handlersByEngineId = new LinkedHashMap<>();
    private final Map<String, FileSession> sessionsById = new LinkedHashMap<>();

    @Override
    public synchronized void register(FileSessionHandler handler)
    {
        Objects.requireNonNull(handler, "handler");
        Objects.requireNonNull(handler.engineId(), "handler.engineId");
        handlersByEngineId.put(handler.engineId(), handler);
    }

    @Override
    public synchronized FileSession open(String fileId, URI uri, String mimeType, String engineId, String connectionId, String initialText)
    {
        Objects.requireNonNull(fileId, "fileId");
        Objects.requireNonNull(uri, "uri");
        Objects.requireNonNull(mimeType, "mimeType");

        FileSession session = new FileSession(fileId, uri, mimeType, engineId, connectionId, 0L);
        sessionsById.put(fileId, session);
        dispatchOpen(session, initialText);
        return session;
    }

    @Override
    public synchronized Optional<FileSession> bind(String fileId, String engineId, String connectionId)
    {
        FileSession existing = sessionsById.get(fileId);
        if (existing == null)
        {
            return Optional.empty();
        }
        boolean wasBound = existing.engineId() != null;
        FileSession next = new FileSession(existing.fileId(), existing.uri(), existing.mimeType(), engineId, connectionId, existing.backendVersion() + 1L);
        sessionsById.put(fileId, next);
        if (!wasBound)
        {
            dispatchOpen(next, null);
        }
        return Optional.of(next);
    }

    @Override
    public synchronized Optional<FileSession> change(String fileId, long version, String text)
    {
        FileSession existing = sessionsById.get(fileId);
        if (existing == null)
        {
            return Optional.empty();
        }
        FileSession next = new FileSession(existing.fileId(), existing.uri(), existing.mimeType(), existing.engineId(), existing.connectionId(), version);
        sessionsById.put(fileId, next);
        FileSessionHandler handler = handlerFor(next);
        if (handler != null)
        {
            handler.onChange(next, version, text);
        }
        return Optional.of(next);
    }

    @Override
    public synchronized Optional<FileSession> close(String fileId)
    {
        FileSession removed = sessionsById.remove(fileId);
        if (removed == null)
        {
            return Optional.empty();
        }
        FileSessionHandler handler = handlerFor(removed);
        if (handler != null)
        {
            handler.onClose(removed);
        }
        return Optional.of(removed);
    }

    @Override
    public synchronized Optional<FileSession> get(String fileId)
    {
        return Optional.ofNullable(sessionsById.get(fileId));
    }

    public synchronized int handlerCount()
    {
        return handlersByEngineId.size();
    }

    public synchronized int sessionCount()
    {
        return sessionsById.size();
    }

    private void dispatchOpen(FileSession session, String initialText)
    {
        FileSessionHandler handler = handlerFor(session);
        if (handler != null)
        {
            handler.onOpen(session, initialText);
        }
    }

    private FileSessionHandler handlerFor(FileSession session)
    {
        String engineId = session.engineId();
        if (engineId == null)
        {
            return null;
        }
        return handlersByEngineId.get(engineId);
    }
}
