package com.queryeer.backend.queryengine.jdbc.sql;

import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

public final class InMemorySqlParseSessionStore implements SqlParseSessionStore
{
    private final Map<String, SqlParseSession> sessions = new ConcurrentHashMap<>();

    @Override
    public void open(String fileId, String grammarId, String text)
    {
        validateFileId(fileId);
        if (grammarId == null
                || grammarId.isBlank())
        {
            throw new IllegalArgumentException("grammarId is required");
        }
        sessions.put(fileId, new SqlParseSession(fileId, 0L, grammarId, text == null ? ""
                : text));
    }

    @Override
    public void change(String fileId, long version, String text)
    {
        validateFileId(fileId);
        SqlParseSession current = sessions.get(fileId);
        if (current == null)
        {
            return;
        }
        sessions.put(fileId, new SqlParseSession(fileId, version, current.grammarId(), text == null ? ""
                : text));
    }

    @Override
    public void close(String fileId)
    {
        validateFileId(fileId);
        sessions.remove(fileId);
    }

    @Override
    public Optional<SqlParseSession> get(String fileId)
    {
        validateFileId(fileId);
        return Optional.ofNullable(sessions.get(fileId));
    }

    private static void validateFileId(String fileId)
    {
        if (fileId == null
                || fileId.isBlank())
        {
            throw new IllegalArgumentException("fileId is required");
        }
    }
}
