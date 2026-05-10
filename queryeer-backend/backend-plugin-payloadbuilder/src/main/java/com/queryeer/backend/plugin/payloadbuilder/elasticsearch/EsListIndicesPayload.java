package com.queryeer.backend.plugin.payloadbuilder.elasticsearch;

import java.util.Map;

/**
 * Payload for {@code payloadbuilder.es.listIndices} action.
 */
public record EsListIndicesPayload(String alias, Map<String, Object> properties)
{
}
