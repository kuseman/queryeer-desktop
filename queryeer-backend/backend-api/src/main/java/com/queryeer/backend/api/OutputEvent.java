package com.queryeer.backend.api;

import java.util.Map;

public record OutputEvent(OutputSeverity severity, String message, Map<String, Object> details)
{
    public OutputEvent(OutputSeverity severity, String message)
    {
        this(severity, message, null);
    }
}
