package com.queryeer.backend.queryengine.jdbc.sql;

public record SqlParseSession(String fileId, long version, String grammarId, String text)
{
}
