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
        // When Jackson converts a Map to PayloadbuilderEngineState, a non-object catalog value becomes null
        Map<String, PayloadbuilderCatalogInstance> catalogs = new LinkedHashMap<>();
        catalogs.put("jdbc1", null);
        PayloadbuilderEngineState invalidState = new PayloadbuilderEngineState(new PayloadbuilderEngineState.PayloadbuilderCatalogState(null, null, catalogs, null));

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> PayloadbuilderEngineStateSupport.parse(invalidState));

        Assertions.assertEquals("Catalog instance for alias 'jdbc1' must be an object", error.getMessage());
    }

    @Test
    void parseRejectsMissingCatalogId()
    {
        PayloadbuilderEngineState invalidState = new PayloadbuilderEngineState(
                new PayloadbuilderEngineState.PayloadbuilderCatalogState(null, null, Map.of("jdbc1", new PayloadbuilderCatalogInstance(null, Map.of("database", "appdb"))), null));

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> PayloadbuilderEngineStateSupport.parse(invalidState));

        Assertions.assertEquals("catalogId is required for alias 'jdbc1'", error.getMessage());
    }

    @Test
    void buildEngineStatePatchIncludesOnlyChangedProperties()
    {
        PayloadbuilderEngineState engineState = new PayloadbuilderEngineState(new PayloadbuilderEngineState.PayloadbuilderCatalogState(null, null,
                Map.of("jdbc1", new PayloadbuilderCatalogInstance("Jdbc", Map.of("database", "appdb", "schema", "public"))), null));
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = PayloadbuilderEngineStateSupport.parse(engineState);
        QuerySession session = new QuerySession(new CatalogRegistry());

        PayloadbuilderEngineStateSupport.applyToSession(session, state);
        session.setCatalogProperty("jdbc1", "database", se.kuseman.payloadbuilder.api.execution.ValueVector.literalAny(1, "reporting"));

        Object patch = PayloadbuilderEngineStateSupport.buildEngineStatePatch(session, state, Map.of(), "1");

        Assertions.assertEquals(Map.of("payloadbuilder", Map.of("catalogs", Map.of("jdbc1", Map.of("catalogId", "Jdbc", "properties", Map.of("database", "reporting"))), "sessionId", "1")), patch);
    }

    @Test
    void buildEngineStatePatchIncludesDefaultCatalogAliasWhenSwitched()
    {
        PayloadbuilderEngineState engineState = new PayloadbuilderEngineState(
                new PayloadbuilderEngineState.PayloadbuilderCatalogState("jdbc1", null, Map.of("jdbc1", new PayloadbuilderCatalogInstance("Jdbc", Map.of("database", "appdb"))), null));
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = PayloadbuilderEngineStateSupport.parse(engineState);
        QuerySession session = new QuerySession(new CatalogRegistry());

        PayloadbuilderEngineStateSupport.applyToSession(session, state);
        session.setDefaultCatalogAlias("jdbc2");

        Object patch = PayloadbuilderEngineStateSupport.buildEngineStatePatch(session, state, Map.of(), "2");

        Assertions.assertEquals(Map.of("payloadbuilder", Map.of("defaultCatalogAlias", "jdbc2", "sessionId", "2")), patch);
    }

    @Test
    void buildEngineStatePatchReturnsPatchWithSessionIdWhenNothingChanged()
    {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("database", "appdb");
        properties.put("timeoutMs", null);
        PayloadbuilderEngineState stateRoot = new PayloadbuilderEngineState(
                new PayloadbuilderEngineState.PayloadbuilderCatalogState(null, null, Map.of("jdbc1", new PayloadbuilderCatalogInstance("Jdbc", properties)), null));
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = PayloadbuilderEngineStateSupport.parse(stateRoot);
        QuerySession session = new QuerySession(new CatalogRegistry());

        PayloadbuilderEngineStateSupport.applyToSession(session, state);

        Object patch = PayloadbuilderEngineStateSupport.buildEngineStatePatch(session, state, Map.of(), "3");

        Assertions.assertNotNull(patch);
        Map<?, ?> patchMap = (Map<?, ?>) patch;
        Map<?, ?> pbPatch = (Map<?, ?>) patchMap.get("payloadbuilder");
        Assertions.assertEquals("3", pbPatch.get("sessionId"));
    }

    @Test
    void parseRejectsUnknownDefaultCatalogAlias()
    {
        PayloadbuilderEngineState invalidState = new PayloadbuilderEngineState(
                new PayloadbuilderEngineState.PayloadbuilderCatalogState("jdbc2", null, Map.of("jdbc1", new PayloadbuilderCatalogInstance("Jdbc", Map.of())), null));

        IllegalArgumentException error = Assertions.assertThrows(IllegalArgumentException.class, () -> PayloadbuilderEngineStateSupport.parse(invalidState));

        Assertions.assertEquals("defaultCatalogAlias must match a mapped alias", error.getMessage());
    }

    @Test
    void applyToSessionSetsDefaultCatalogAlias()
    {
        PayloadbuilderEngineState stateRoot = new PayloadbuilderEngineState(
                new PayloadbuilderEngineState.PayloadbuilderCatalogState("jdbc1", null, Map.of("jdbc1", new PayloadbuilderCatalogInstance("Jdbc", Map.of())), null));
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = PayloadbuilderEngineStateSupport.parse(stateRoot);
        QuerySession session = new QuerySession(new CatalogRegistry());

        PayloadbuilderEngineStateSupport.applyToSession(session, state);

        Assertions.assertEquals("jdbc1", session.getDefaultCatalogAlias());
    }

    @Test
    void buildEngineStatePatchIncludesSessionId()
    {
        PayloadbuilderEngineState engineState = new PayloadbuilderEngineState(
                new PayloadbuilderEngineState.PayloadbuilderCatalogState(null, null, Map.of("jdbc1", new PayloadbuilderCatalogInstance("Jdbc", Map.of())), "41"));
        Assertions.assertEquals("41", engineState.payloadbuilder()
                .sessionId());
        PayloadbuilderEngineStateSupport.PayloadbuilderCatalogState state = PayloadbuilderEngineStateSupport.parse(engineState);
        QuerySession session = new QuerySession(new CatalogRegistry());

        PayloadbuilderEngineStateSupport.applyToSession(session, state);

        Object patch = PayloadbuilderEngineStateSupport.buildEngineStatePatch(session, state, Map.of(), "42");

        Assertions.assertNotNull(patch);
        Map<?, ?> patchMap = (Map<?, ?>) patch;
        Map<?, ?> pbPatch = (Map<?, ?>) patchMap.get("payloadbuilder");
        Assertions.assertNotNull(pbPatch);
        Assertions.assertEquals("42", pbPatch.get("sessionId"));
    }
}
