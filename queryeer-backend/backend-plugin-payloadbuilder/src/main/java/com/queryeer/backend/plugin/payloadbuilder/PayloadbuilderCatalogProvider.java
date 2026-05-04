package com.queryeer.backend.plugin.payloadbuilder;

import java.util.Map;
import java.util.Set;

import se.kuseman.payloadbuilder.api.catalog.Catalog;

public interface PayloadbuilderCatalogProvider
{
    String catalogId();

    Catalog createCatalog();

    default Set<String> actions()
    {
        return Set.of();
    }

    default Object invoke(String action, Object payload)
    {
        throw new IllegalArgumentException("Unsupported payloadbuilder action: " + action);
    }

    /** Resolves connection properties by connectionId from ConfigService. Returns empty map if not found. */
    default Map<String, Object> resolveConnection(String connectionId)
    {
        return Map.of();
    }
}
