package com.queryeer.backend.api.parse;

import java.util.Map;

public record ParseSessionSnapshot(String engineId, String fileId, long version, String languageId, boolean hasErrors, Object state, Map<String, Object> attributes)
{
    public ParseSessionSnapshot
    {
        attributes = attributes == null ? Map.of()
                : Map.copyOf(attributes);
    }
}
