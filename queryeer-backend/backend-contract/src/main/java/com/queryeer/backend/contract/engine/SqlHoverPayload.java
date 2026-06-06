package com.queryeer.backend.contract.engine;

public record SqlHoverPayload(String fileId, String text, String connectionId, String database, Object engineState, SqlHoverCursor cursor)
{
    public record SqlHoverCursor(int line, int column)
    {
    }
}
