package com.queryeer.backend.api.parse;

import java.util.Map;

public record ParseResult(boolean hasErrors, Object state, Map<String, Object> attributes)
{
    public ParseResult
    {
        attributes = attributes == null ? Map.of()
                : Map.copyOf(attributes);
    }
}
