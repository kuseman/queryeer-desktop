package com.queryeer.backend.plugin.payloadbuilder;

import java.util.Map;
import java.util.Set;

import se.kuseman.payloadbuilder.api.catalog.Catalog;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

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
        return null;
    }

    /** Inject properties for this catalog / alias combo. */
    default void injectProperties(QuerySession querySession, String alias, Map<String, Object> properties)
    {
    }
}
