package com.queryeer.backend.plugin.payloadbuilder;

import java.util.Map;

/**
 * Engine state sent into payloadbuilder query execution.
 */
record PayloadbuilderEngineState(PayloadbuilderCatalogState payloadbuilder)
{
    record PayloadbuilderCatalogState(String defaultCatalogAlias, String selectedEnvironmentId, Map<String, PayloadbuilderCatalogInstance> catalogs)
    {
    }
}
