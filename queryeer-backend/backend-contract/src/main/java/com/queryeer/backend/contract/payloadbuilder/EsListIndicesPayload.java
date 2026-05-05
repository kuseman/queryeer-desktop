package com.queryeer.backend.contract.payloadbuilder;

import java.util.Map;

/**
 * Payload for {@code payloadbuilder.es.listIndices} action.
 */
public record EsListIndicesPayload(Map<String, Object> properties)
{
}
