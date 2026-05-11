package com.queryeer.backend.api.parse;

import java.util.Optional;

public interface IncrementalParseSessionService
{
    ParseSessionSnapshot open(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction);

    ParseSessionSnapshot change(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction);

    void close(String engineId, String fileId);

    Optional<ParseSessionSnapshot> get(String engineId, String fileId);
}
