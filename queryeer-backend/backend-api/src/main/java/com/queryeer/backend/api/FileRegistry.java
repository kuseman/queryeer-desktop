package com.queryeer.backend.api;

import java.net.URI;
import java.util.Optional;

public interface FileRegistry
{
    FileSession open(String fileId, URI uri, String mimeType, String engineId, String connectionId, String initialText);

    Optional<FileSession> bind(String fileId, String engineId, String connectionId);

    Optional<FileSession> change(String fileId, long version, String text);

    Optional<FileSession> close(String fileId);

    Optional<FileSession> get(String fileId);
}
