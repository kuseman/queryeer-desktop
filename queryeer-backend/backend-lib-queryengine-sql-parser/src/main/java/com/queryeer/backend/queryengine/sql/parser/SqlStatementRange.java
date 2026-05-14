package com.queryeer.backend.queryengine.sql.parser;

record SqlStatementRange(int startOffset, int endOffset, int cursorOffset)
{
    boolean contains(SqlToken token)
    {
        return token.startOffset() >= startOffset
                && token.endOffset() <= endOffset;
    }
}
