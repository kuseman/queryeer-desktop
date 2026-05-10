package com.queryeer.backend.plugin.payloadbuilder;

import java.util.Map;

/**
 * Engine state sent into payloadbuilder query execution.
 */
public record PayloadbuilderEngineState(PayloadbuilderCatalogState payloadbuilder)
{
    public record PayloadbuilderCatalogState(String defaultCatalogAlias, String selectedEnvironmentId, Map<String, PayloadbuilderCatalogInstance> catalogs)
    {
    }
}
