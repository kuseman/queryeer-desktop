package com.queryeer.backend.api;

import java.net.URI;
import java.util.Optional;

public record FileSession(String fileId, URI uri, String mimeType, String engineId, String connectionId, long backendVersion)
{
    public Optional<String> engineIdOptional()
    {
        return Optional.ofNullable(engineId);
    }

    public Optional<String> connectionIdOptional()
    {
        return Optional.ofNullable(connectionId);
    }
}
