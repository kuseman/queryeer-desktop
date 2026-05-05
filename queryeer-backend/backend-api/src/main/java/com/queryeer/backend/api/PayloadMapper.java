package com.queryeer.backend.api;

/**
 * Converts opaque JSON-like objects (usually {@code Map} or Jackson nodes) into typed Java records. This is the canonical way to deserialize payloads that cross runtime boundaries (envelopes, engine
 * states, settings documents) without raw {@code Map<String, Object>} casting.
 */
public interface PayloadMapper
{
    <T> T convert(Object fromValue, Class<T> toValueType);
}
