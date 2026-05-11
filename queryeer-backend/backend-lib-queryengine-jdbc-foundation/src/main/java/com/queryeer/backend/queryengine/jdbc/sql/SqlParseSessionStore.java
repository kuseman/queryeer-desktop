package com.queryeer.backend.queryengine.jdbc.sql;

import java.util.Optional;

public interface SqlParseSessionStore
{
    void open(String fileId, String grammarId, String text);

    void change(String fileId, long version, String text);

    void close(String fileId);

    Optional<SqlParseSession> get(String fileId);
}
