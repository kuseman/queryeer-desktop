package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import java.util.Map;
import java.util.Set;

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
    void doesNotEnforceTheRangeAgainstADevelopmentBuildOfAnotherVersion()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "0.21.0-SNAPSHOT"), plugin("dialect", "1.0.0", Map.of("jdbc", "^0.20.0"))));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(List.of("jdbc", "dialect"), ids(plan));
        assertEquals(Map.of("dialect", "Needs jdbc ^0.20.0, but 0.21.0-SNAPSHOT is a development build; the range isn't enforced"), plan.warnings());
    }

    @Test
    void anActivatedPluginsStatusCarriesTheWarning() throws Exception
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin("jdbc", "0.21.0-SNAPSHOT"));
        runtime.register(plugin("dialect", "1.0.0", Map.of("jdbc", "^0.20.0")));

        runtime.activateAll(BackendPlatformServices.fileBased(Map.of(), new com.queryeer.backend.core.security.SecuritySession())
                .pluginContext());

        PluginRuntimeStatus status = runtime.statuses()
                .stream()
                .filter(s -> s.pluginId()
                        .equals("dialect"))
                .findFirst()
                .orElseThrow();
        assertEquals(PluginRuntimeState.ACTIVATED, status.state());
        assertEquals("Activated. Needs jdbc ^0.20.0, but 0.21.0-SNAPSHOT is a development build; the range isn't enforced", status.reason());
        assertEquals(Set.of("dialect"), runtime.warnings()
                .keySet());
    }

    @Test
    void namesEveryRangeThatIsNotEnforced()
    {
        PluginValidationPlan plan = PluginValidation
                .planActivation(List.of(plugin("jdbc", "0.21.0-SNAPSHOT"), plugin("parser", "0.21.0-SNAPSHOT"), plugin("dialect", "1.0.0", ordered("jdbc", "^0.20.0", "parser", "^0.20.0"))));

        assertEquals("Needs jdbc ^0.20.0, but 0.21.0-SNAPSHOT is a development build; the range isn't enforced. "
                     + "Needs parser ^0.20.0, but 0.21.0-SNAPSHOT is a development build; the range isn't enforced",
                plan.warnings()
                        .get("dialect"));
    }

    @Test
    void aPluginThatFailsAfterARelaxedCheckKeepsTheWarningInItsStatus() throws Exception
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin("jdbc", "0.21.0-SNAPSHOT"));
        runtime.register(new FailingPlugin(new PluginDescriptor("dialect", "dialect", "1.0.0", List.of("jdbc"), List.of(), List.of(), Map.of("jdbc", "^0.20.0"))));

        runtime.activateAll(BackendPlatformServices.fileBased(Map.of(), new com.queryeer.backend.core.security.SecuritySession())
                .pluginContext());

        PluginRuntimeStatus status = runtime.statuses()
                .stream()
                .filter(s -> s.pluginId()
                        .equals("dialect"))
                .findFirst()
                .orElseThrow();
        assertEquals(PluginRuntimeState.FAILED, status.state());
        assertEquals("java.lang.NoSuchMethodError. Needs jdbc ^0.20.0, but 0.21.0-SNAPSHOT is a development build; the range isn't enforced", status.reason());
    }

    @Test
    void enforcesTheRangeAgainstARelease()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "0.21.0"), plugin("dialect", "1.0.0", Map.of("jdbc", "^0.20.0"))));

        assertEquals("Needs jdbc ^0.20.0, but 0.21.0 is installed", plan.skipReasons()
                .get("dialect"));
        assertEquals(Map.of(), plan.warnings());
    }

    @Test
    void aDevelopmentBuildStillSkipsAPluginThatIsMissingADependency()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "0.21.0-SNAPSHOT"), plugin("dialect", "1.0.0", ordered("jdbc", "^0.20.0", "other", "^1.0.0"))));

        assertEquals("Missing dependency: other", plan.skipReasons()
                .get("dialect"));
        assertEquals(Map.of(), plan.warnings());
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

    /** Dependencies in the given order, unlike {@code Map.of}. */
    private static Map<String, String> ordered(String... idsAndRanges)
    {
        Map<String, String> result = new java.util.LinkedHashMap<>();
        for (int i = 0; i < idsAndRanges.length; i += 2)
        {
            result.put(idsAndRanges[i], idsAndRanges[i + 1]);
        }
        return result;
    }

    private record FailingPlugin(PluginDescriptor descriptor) implements BackendPlugin
    {
        @Override
        public void activate(BackendPluginContext context, PluginDescriptor pluginDescriptor)
        {
            throw new NoSuchMethodError();
        }
    }

    private record StubPlugin(PluginDescriptor descriptor) implements BackendPlugin
    {
        @Override
        public void activate(BackendPluginContext context, PluginDescriptor pluginDescriptor)
        {
        }
    }
}
