package com.queryeer.backend.plugin.payloadbuilder;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import se.kuseman.payloadbuilder.core.catalog.CatalogRegistry;
import se.kuseman.payloadbuilder.core.execution.QuerySession;

class PayloadbuilderEngineStateSupportTest
{
    @Test
    void parseRejectsInvalidCatalogShape()
    {
        Map<String, Object> invalidState = Map.of("payloadbuilder", Map.of("catalogs", Map.of("jdbc1", "bad")));

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> PayloadbuilderEngineStateSupport.parse(invalidState));

        Assertions.assertEquals("Catalog instance for alias 'jdbc1' must be an object", error.getMessage());
    }

    @Test
    void parseRejectsMissingCatalogId()
    {
        Map<String, Object> invalidState = Map.of("payloadbuilder", Map.of("catalogs", Map.of("jdbc1", Map.of("properties", Map.of("database", "appdb")))));

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> PayloadbuilderEngineStateSupport.parse(invalidState));

        Assertions.assertEquals("catalogId is required for alias 'jdbc1'", error.getMessage());
    }

    @Test
    void buildEngineStatePatchIncludesOnlyChangedProperties()
    {
        Map<String, Object> engineState = Map.of("payloadbuilder", Map.of("catalogs", Map.of("jdbc1", Map.of("catalogId", "Jdbc", "properties", Map.of("database", "appdb", "schema", "public")))));
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = PayloadbuilderEngineStateSupport.parse(engineState);
        QuerySession session = new QuerySession(new CatalogRegistry());

        PayloadbuilderEngineStateSupport.applyToSession(session, state);
        session.setCatalogProperty("jdbc1", "database", se.kuseman.payloadbuilder.api.execution.ValueVector.literalAny(1, "reporting"));

        Object patch = PayloadbuilderEngineStateSupport.buildEngineStatePatch(session, state);

        Assertions.assertEquals(Map.of("payloadbuilder", Map.of("catalogs", Map.of("jdbc1", Map.of("catalogId", "Jdbc", "properties", Map.of("database", "reporting"))))), patch);
    }

    @Test
    void buildEngineStatePatchReturnsNullWhenNothingChanged()
    {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("database", "appdb");
        properties.put("timeoutMs", null);
        Map<String, Object> stateRoot = Map.of("payloadbuilder", Map.of("catalogs", Map.of("jdbc1", Map.of("catalogId", "Jdbc", "properties", properties))));
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = PayloadbuilderEngineStateSupport.parse(stateRoot);
        QuerySession session = new QuerySession(new CatalogRegistry());

        PayloadbuilderEngineStateSupport.applyToSession(session, state);

        Assertions.assertNull(PayloadbuilderEngineStateSupport.buildEngineStatePatch(session, state));
    }
}
