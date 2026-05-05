package com.queryeer.backend.contract.payloadbuilder;

import java.util.Map;

/**
 * Engine state sent into payloadbuilder query execution.
 */
public record PayloadbuilderEngineState(PayloadbuilderCatalogState payloadbuilder)
{
    public record PayloadbuilderCatalogState(String defaultCatalogAlias, Map<String, PayloadbuilderCatalogInstance> catalogs)
    {
    }
}
