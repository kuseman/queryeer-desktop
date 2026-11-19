package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;

/** Dependency version ranges, and skipping the dependents of skipped plugins. */
class PluginValidationVersionTest
{
    @Test
    void activatesWhenTheVersionMatches()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "0.20.1"), plugin("dialect", "1.0.0", Map.of("jdbc", "^0.20.0"))));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(List.of("jdbc", "dialect"), ids(plan));
    }

    @Test
    void acceptsADevelopmentBuildOfTheVersion()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "0.20.0-SNAPSHOT"), plugin("dialect", "1.0.0", Map.of("jdbc", "^0.20.0"))));

        assertEquals(Map.of(), plan.skipReasons());
    }

    @Test
    void skipsWhenTheVersionDoesNotMatch()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "0.19.0"), plugin("dialect", "1.0.0", Map.of("jdbc", "^0.20.0"))));

        assertEquals("Needs jdbc ^0.20.0, but 0.19.0 is installed", plan.skipReasons()
                .get("dialect"));
        assertEquals(PluginRuntimeState.SKIPPED, plan.preActivationStates()
                .get("dialect"));
        assertEquals(List.of("jdbc"), ids(plan));
    }

    @Test
    void skipsWhenTheDependencyVersionIsNotSemVer()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "dev"), plugin("dialect", "1.0.0", Map.of("jdbc", "^0.20.0"))));

        assertTrue(plan.skipReasons()
                .get("dialect")
                .startsWith("Cannot check the version of jdbc"));
    }

    @Test
    void anyVersionWithoutARange()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "dev"), plugin("dialect", "1.0.0", Map.of())));

        assertEquals(Map.of(), plan.skipReasons());
    }

    @Test
    void namesTheMissingDependency()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("dialect", "1.0.0", Map.of("jdbc", "^0.20.0"))));

        assertEquals("Missing dependency: jdbc", plan.skipReasons()
                .get("dialect"));
    }

    @Test
    void skipsTheDependentsOfASkippedPlugin()
    {
        // dialect is skipped for its version, so extension (which needs dialect) is skipped too, whatever order they come in
        PluginValidationPlan plan = PluginValidation
                .planActivation(List.of(plugin("extension", "1.0.0", Map.of("dialect", "")), plugin("jdbc", "0.19.0"), plugin("dialect", "1.0.0", Map.of("jdbc", "^0.20.0"))));

        assertEquals("Dependency dialect was skipped", plan.skipReasons()
                .get("extension"));
        assertEquals(List.of("jdbc"), ids(plan));
    }

    @Test
    void capabilitiesOfASkippedPluginAreNotProvided()
    {
        BackendPlugin provider = new StubPlugin(new PluginDescriptor("provider", "provider", "1.0.0", List.of("missing"), List.of("cap.x"), List.of()));
        BackendPlugin consumer = new StubPlugin(new PluginDescriptor("consumer", "consumer", "1.0.0", List.of(), List.of(), List.of("cap.x")));

        PluginValidationPlan plan = PluginValidation.planActivation(List.of(consumer, provider));

        assertEquals("Missing required capability: cap.x", plan.skipReasons()
                .get("consumer"));
    }

    @Test
    void skipsPluginsInADependencyCycleAndActivatesTheOthers()
    {
        // An installed plugin's cycle must not stop the backend: self, a <-> b, and c depending on the cycle are skipped
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "0.20.0"), plugin("self", "1.0.0", Map.of("self", "")), plugin("a", "1.0.0", Map.of("b", "")),
                plugin("b", "1.0.0", Map.of("a", "")), plugin("c", "1.0.0", Map.of("a", "")), plugin("dialect", "1.0.0", Map.of("jdbc", ""))));

        assertEquals(List.of("jdbc", "dialect"), ids(plan));
        for (String id : List.of("self", "a", "b", "c"))
        {
            assertEquals(PluginRuntimeState.SKIPPED, plan.preActivationStates()
                    .get(id), id);
            assertTrue(plan.skipReasons()
                    .get(id)
                    .startsWith("Dependency cycle"), id);
        }
    }

    @Test
    void aCapabilityFromAPluginInACycleIsNotProvided()
    {
        // a <-> b, a provides cap.x; c needs cap.x without depending on a
        BackendPlugin a = new StubPlugin(new PluginDescriptor("a", "a", "1.0.0", List.of("b"), List.of("cap.x"), List.of()));
        BackendPlugin b = new StubPlugin(new PluginDescriptor("b", "b", "1.0.0", List.of("a"), List.of(), List.of()));
        BackendPlugin c = new StubPlugin(new PluginDescriptor("c", "c", "1.0.0", List.of(), List.of(), List.of("cap.x")));

        PluginValidationPlan plan = PluginValidation.planActivation(List.of(c, a, b));

        assertEquals("Missing required capability: cap.x", plan.skipReasons()
                .get("c"));
        assertEquals(List.of(), ids(plan));
    }

    private static List<String> ids(PluginValidationPlan plan)
    {
        return plan.activationOrder()
                .stream()
                .map(p -> p.descriptor()
                        .id())
                .toList();
    }

    private static BackendPlugin plugin(String id, String version)
    {
        return plugin(id, version, Map.of());
    }

    /** A plugin depending on each key of {@code dependencies}, with the value as its version range; an empty value means no range. */
    private static BackendPlugin plugin(String id, String version, Map<String, String> dependencies)
    {
        Map<String, String> ranges = new java.util.LinkedHashMap<>(dependencies);
        ranges.values()
                .removeIf(String::isEmpty);
        return new StubPlugin(new PluginDescriptor(id, id, version, List.copyOf(dependencies.keySet()), List.of(), List.of(), ranges));
    }

    private record StubPlugin(PluginDescriptor descriptor) implements BackendPlugin
    {
        @Override
        public void activate(BackendPluginContext context, PluginDescriptor pluginDescriptor)
        {
        }
    }
}
