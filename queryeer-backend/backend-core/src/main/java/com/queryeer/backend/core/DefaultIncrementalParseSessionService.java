package com.queryeer.backend.core;

import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import com.queryeer.backend.api.parse.IncrementalParseFunction;
import com.queryeer.backend.api.parse.IncrementalParseSessionService;
import com.queryeer.backend.api.parse.ParseResult;
import com.queryeer.backend.api.parse.ParseSessionSnapshot;

public final class DefaultIncrementalParseSessionService implements IncrementalParseSessionService
{
    private final ConcurrentMap<String, ParseSessionSnapshot> snapshots = new ConcurrentHashMap<>();

    @Override
    public ParseSessionSnapshot open(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction)
    {
        return update(engineId, fileId, version, languageId, text, parseFunction);
    }

    @Override
    public ParseSessionSnapshot change(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction)
    {
        return update(engineId, fileId, version, languageId, text, parseFunction);
    }

    @Override
    public void close(String engineId, String fileId)
    {
        snapshots.remove(key(engineId, fileId));
    }

    @Override
    public Optional<ParseSessionSnapshot> get(String engineId, String fileId)
    {
        return Optional.ofNullable(snapshots.get(key(engineId, fileId)));
    }

    private ParseSessionSnapshot update(String engineId, String fileId, long version, String languageId, String text, IncrementalParseFunction parseFunction)
    {
        Objects.requireNonNull(parseFunction, "parseFunction");
        String key = key(engineId, fileId);
        ParseSessionSnapshot previous = snapshots.get(key);
        Object previousState = previous == null ? null
                : previous.state();
        ParseResult result = parseFunction.parse(languageId, text == null ? ""
                : text, previousState);
        ParseSessionSnapshot next = new ParseSessionSnapshot(engineId, fileId, version, languageId, result.hasErrors(), result.state(), result.attributes());
        snapshots.put(key, next);
        return next;
    }

    private static String key(String engineId, String fileId)
    {
        if (engineId == null
                || engineId.isBlank())
        {
            throw new IllegalArgumentException("engineId is required");
        }
        if (fileId == null
                || fileId.isBlank())
        {
            throw new IllegalArgumentException("fileId is required");
        }
        return engineId + "::" + fileId;
    }
}
