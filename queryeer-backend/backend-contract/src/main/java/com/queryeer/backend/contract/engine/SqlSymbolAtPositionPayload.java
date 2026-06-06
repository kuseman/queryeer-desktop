package com.queryeer.backend.contract.engine;

public record SqlSymbolAtPositionPayload(String fileId, String text, SymbolCursor cursor, String connectionId, String database, Object engineState)
{
    public record SymbolCursor(int line, int column)
    {
    }
}
