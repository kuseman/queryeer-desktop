package com.queryeer.backend.contract.engine;

public record SqlCompletePayload(String fileId, Long version, String text, String connectionId, String database, Object engineState, SqlCompleteCursor cursor, SqlCompleteTrigger trigger,
        SqlCompleteLimits limits)
{
    public record SqlCompleteCursor(int line, int column)
    {
    }

    public record SqlCompleteTrigger(String kind, String character)
    {
    }

    public record SqlCompleteLimits(Integer maxItems)
    {
    }
}
