package com.queryeer.backend.plugin.payloadbuilder;

import java.util.Map;

/**
 * A single catalog instance inside the payloadbuilder engine state.
 */
public record PayloadbuilderCatalogInstance(String catalogId, Map<String, Object> properties)
{
}
