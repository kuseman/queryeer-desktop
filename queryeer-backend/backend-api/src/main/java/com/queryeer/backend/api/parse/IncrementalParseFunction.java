package com.queryeer.backend.api.parse;

@FunctionalInterface
public interface IncrementalParseFunction
{
    ParseResult parse(String languageId, String text, Object previousState);
}
