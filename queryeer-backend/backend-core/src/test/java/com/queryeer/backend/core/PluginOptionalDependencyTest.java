package com.queryeer.backend.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.core.security.SecuritySession;

/** Optional dependencies: used when loaded and in range, and never a reason to skip a plugin. */
class PluginOptionalDependencyTest
{
    @Test
    void usesAnOptionalDependencyThatIsLoadedAndOrdersAfterIt()
    {
        // Listed before its optional dependency, still activated after it
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(withOptional("mongo", "pb", "^0.21.0"), plugin("pb", "0.21.0")));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(List.of("pb", "mongo"), ids(plan));
        assertEquals(Set.of("pb"), plan.activeOptionalDependencies()
                .get("mongo"));
        assertEquals(Map.of(), plan.warnings());
    }

    @Test
    void loadsWithoutAMissingOptionalDependency()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(withOptional("mongo", "pb", "^0.21.0")));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(List.of("mongo"), ids(plan));
        assertEquals(Set.of(), plan.activeOptionalDependencies()
                .get("mongo"));
        assertEquals(Map.of(), plan.warnings());
    }

    @Test
    void loadsWithoutASkippedOptionalDependency()
    {
        // pb is skipped for its own missing dependency
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(withOptional("mongo", "pb", "^0.21.0"), plugin("pb", "0.21.0", Map.of("absent", ""))));

        assertEquals(Set.of("pb"), plan.skipReasons()
                .keySet());
        assertEquals(List.of("mongo"), ids(plan));
        assertEquals(Set.of(), plan.activeOptionalDependencies()
                .get("mongo"));
    }

    @Test
    void treatsAnOptionalDependencyOutOfRangeAsAbsentWithAWarning()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(withOptional("mongo", "pb", "^0.21.0"), plugin("pb", "0.22.0")));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(Set.of(), plan.activeOptionalDependencies()
                .get("mongo"));
        assertEquals("Optional dependency pb not used: needs ^0.21.0, but 0.22.0 is installed", plan.warnings()
                .get("mongo"));
    }

    @Test
    void usesAnOptionalDevelopmentBuildOutOfRangeWithAWarning()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(withOptional("mongo", "pb", "^0.21.0"), plugin("pb", "0.22.0-SNAPSHOT")));

        assertEquals(Set.of("pb"), plan.activeOptionalDependencies()
                .get("mongo"));
        assertEquals("Needs pb ^0.21.0, but 0.22.0-SNAPSHOT is a development build; the range isn't enforced", plan.warnings()
                .get("mongo"));
    }

    @Test
    void anOptionalDependencyOnARequiredCycleDoesNotSkipThePlugin()
    {
        // b and c require each other; mongo only lists b as optional
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("b", "1.0.0", Map.of("c", "")), plugin("c", "1.0.0", Map.of("b", "")), withOptional("mongo", "b", "")));

        assertEquals(Set.of("b", "c"), plan.skipReasons()
                .keySet());
        assertEquals(List.of("mongo"), ids(plan));
        assertEquals(Set.of(), plan.activeOptionalDependencies()
                .get("mongo"));
    }

    @Test
    void anOptionalDependencyThatClosesACycleIsNotUsed()
    {
        // a lists b as optional, and b requires a: a can't activate after b, so a doesn't use b
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(withOptional("a", "b", ""), plugin("b", "1.0.0", Map.of("a", ""))));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(List.of("a", "b"), ids(plan));
        assertEquals(Set.of(), plan.activeOptionalDependencies()
                .get("a"));
        assertEquals("Optional dependency b not used: it would close a dependency cycle", plan.warnings()
                .get("a"));
    }

    @Test
    void anOptionalDependencyOnItselfIsNotUsed()
    {
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(withOptional("a", "a", "")));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(List.of("a"), ids(plan));
        assertEquals(Set.of(), plan.activeOptionalDependencies()
                .get("a"));
    }

    @Test
    void aPluginThatOnlyDependsOnACycleKeepsItsOptionalDependency()
    {
        // a and b list each other as optional, which is a cycle; c lists a as optional and isn't in it
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(withOptional("a", "b", ""), withOptional("b", "a", ""), withOptional("c", "a", "")));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(Set.of("a"), plan.activeOptionalDependencies()
                .get("c"));
        List<String> order = ids(plan);
        assertTrue(order.indexOf("a") < order.indexOf("c"), order.toString());
        assertTrue(plan.warnings()
                .get("a")
                .contains("would close a dependency cycle"));
    }

    @Test
    void anOptionalDependencyBetweenTwoCyclesIsKept()
    {
        // a<->b and x<->y are optional cycles; a -> x links them but is on no cycle
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(optional("a", "b", "x"), optional("b", "a"), optional("x", "y"), optional("y", "x")));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(Set.of("x"), plan.activeOptionalDependencies()
                .get("a"));
        List<String> order = ids(plan);
        assertTrue(order.indexOf("x") < order.indexOf("a"), order.toString());
        assertEquals("Optional dependency b not used: it would close a dependency cycle", plan.warnings()
                .get("a"));
    }

    @Test
    void aPluginOnAPathBetweenTwoCyclesKeepsItsOptionalDependencies()
    {
        // a -> z -> x, all optional, where z is in no cycle
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(optional("a", "b", "z"), optional("b", "a"), optional("z", "x"), optional("x", "y"), optional("y", "x")));

        assertEquals(Set.of("x"), plan.activeOptionalDependencies()
                .get("z"));
        assertEquals(Set.of("z"), plan.activeOptionalDependencies()
                .get("a"));
        assertEquals(null, plan.warnings()
                .get("z"));
        List<String> order = ids(plan);
        assertTrue(order.indexOf("x") < order.indexOf("z")
                && order.indexOf("z") < order.indexOf("a"), order.toString());
    }

    @Test
    void anOptionalDependencyOnAPluginThatRequiresAnotherCycleIsKept()
    {
        // a<->b and x<->y optional cycles; b -> z optional, z requires x
        PluginValidationPlan plan = PluginValidation.planActivation(
                List.of(optional("a", "b"), optional("b", "a", "z"), new StubPlugin(descriptor("z", "1.0.0", List.of("x"), Map.of(), List.of())), optional("x", "y"), optional("y", "x")));

        assertEquals(Map.of(), plan.skipReasons());
        assertEquals(Set.of("z"), plan.activeOptionalDependencies()
                .get("b"));
        List<String> order = ids(plan);
        assertTrue(order.indexOf("x") < order.indexOf("z")
                && order.indexOf("z") < order.indexOf("b"), order.toString());
    }

    @Test
    void mergesRequiredAndOptionalWarnings()
    {
        PluginDescriptor mongo = descriptor("mongo", "1.0.0", List.of("jdbc"), Map.of("jdbc", "^0.20.0", "pb", "^0.21.0"), List.of("pb"));
        PluginValidationPlan plan = PluginValidation.planActivation(List.of(plugin("jdbc", "0.21.0-SNAPSHOT"), plugin("pb", "0.22.0"), new StubPlugin(mongo)));

        assertEquals("Needs jdbc ^0.20.0, but 0.21.0-SNAPSHOT is a development build; the range isn't enforced. Optional dependency pb not used: needs ^0.21.0, but 0.22.0 is installed",
                plan.warnings()
                        .get("mongo"));
    }

    @Test
    void theStatusOfAPluginWithAnUnusedOptionalDependencySaysWhy() throws Exception
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin("pb", "0.22.0"));
        runtime.register(withOptional("mongo", "pb", "^0.21.0"));

        runtime.activateAll(BackendPlatformServices.fileBased(Map.of(), new SecuritySession())
                .pluginContext());

        PluginRuntimeStatus status = runtime.statuses()
                .stream()
                .filter(s -> s.pluginId()
                        .equals("mongo"))
                .findFirst()
                .orElseThrow();
        assertEquals(PluginRuntimeState.ACTIVATED, status.state());
        assertEquals("Activated. Optional dependency pb not used: needs ^0.21.0, but 0.22.0 is installed", status.reason());
    }

    @Test
    void theStatusShowsAnOptionalFeatureThePluginSkippedWhileActivating() throws Exception
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(new LoggingPlugin(descriptor("mongo", "1.0.0", List.of(), Map.of(), List.of()), List.of("Catalog extension failed")));
        runtime.register(new LoggingPlugin(descriptor("kafka", "1.0.0", List.of(), Map.of(), List.of()), List.of("first", "second")));
        runtime.register(plugin("quiet", "1.0.0"));

        runtime.activateAll(BackendPlatformServices.fileBased(Map.of(), new SecuritySession())
                .pluginContext());

        Map<String, PluginRuntimeStatus> statuses = new LinkedHashMap<>();
        runtime.statuses()
                .forEach(status -> statuses.put(status.pluginId(), status));
        assertEquals(PluginRuntimeState.ACTIVATED, statuses.get("mongo")
                .state());
        assertEquals("Activated, with an error: Catalog extension failed", statuses.get("mongo")
                .reason());
        assertEquals("Activated, with 2 errors, the first: first", statuses.get("kafka")
                .reason());
        assertEquals("Activated", statuses.get("quiet")
                .reason());
    }

    @Test
    void anActivePluginSeesItsActiveDependenciesOnly() throws Exception
    {
        Map<String, BackendPluginContext> contexts = new LinkedHashMap<>();
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(new RecordingPlugin(descriptor("jdbc", "0.21.0", List.of(), Map.of(), List.of()), contexts, false));
        runtime.register(new RecordingPlugin(descriptor("pb", "0.21.0", List.of(), Map.of(), List.of()), contexts, false));
        runtime.register(new RecordingPlugin(descriptor("broken", "0.21.0", List.of(), Map.of(), List.of()), contexts, true));
        runtime.register(
                new RecordingPlugin(descriptor("mongo", "1.0.0", List.of("jdbc"), Map.of("pb", "^0.21.0", "kafka", "^1.0.0", "broken", ""), List.of("pb", "kafka", "broken")), contexts, false));

        runtime.activateAll(BackendPlatformServices.fileBased(Map.of(), new SecuritySession())
                .pluginContext());

        BackendPluginContext mongo = contexts.get("mongo");
        assertTrue(mongo.isDependencyActive("jdbc"), "required dependency");
        assertTrue(mongo.isDependencyActive("pb"), "optional dependency in use");
        assertFalse(mongo.isDependencyActive("kafka"), "optional dependency missing");
        assertFalse(mongo.isDependencyActive("broken"), "optional dependency that failed to activate");
        assertFalse(mongo.isDependencyActive("unrelated"), "not a dependency");
    }

    private static List<String> ids(PluginValidationPlan plan)
    {
        return plan.activationOrder()
                .stream()
                .map(plugin -> plugin.descriptor()
                        .id())
                .toList();
    }

    private static BackendPlugin plugin(String id, String version)
    {
        return plugin(id, version, Map.of());
    }

    /** A plugin depending on each key of {@code required}, with the value as its version range; an empty value means no range. */
    private static BackendPlugin plugin(String id, String version, Map<String, String> required)
    {
        Map<String, String> ranges = new LinkedHashMap<>(required);
        ranges.values()
                .removeIf(String::isEmpty);
        return new StubPlugin(descriptor(id, version, List.copyOf(required.keySet()), ranges, List.of()));
    }

    private static BackendPlugin withOptional(String id, String optional, String range)
    {
        return new StubPlugin(descriptor(id, "1.0.0", List.of(), Map.of(optional, range), List.of(optional)));
    }

    /** A plugin with only optional dependencies, without ranges. */
    private static BackendPlugin optional(String id, String... optionalIds)
    {
        return new StubPlugin(descriptor(id, "1.0.0", List.of(), Map.of(), List.of(optionalIds)));
    }

    private static PluginDescriptor descriptor(String id, String version, List<String> required, Map<String, String> ranges, List<String> optional)
    {
        Map<String, String> withoutEmpty = new LinkedHashMap<>(ranges);
        withoutEmpty.values()
                .removeIf(String::isEmpty);
        return new PluginDescriptor(id, id, version, required, List.of(), List.of(), withoutEmpty, optional);
    }

    private record StubPlugin(PluginDescriptor descriptor) implements BackendPlugin
    {
        @Override
        public void activate(BackendPluginContext context, PluginDescriptor pluginDescriptor)
        {
        }
    }

    /** Logs each error while activating, as a plugin does that catches the failure of an optional feature. */
    private record LoggingPlugin(PluginDescriptor descriptor, List<String> errors) implements BackendPlugin
    {
        @Override
        public void activate(BackendPluginContext context, PluginDescriptor pluginDescriptor)
        {
            errors.forEach(error -> context.logger()
                    .error(error, null));
        }
    }

    private record RecordingPlugin(PluginDescriptor descriptor, Map<String, BackendPluginContext> contexts, boolean fail) implements BackendPlugin
    {
        @Override
        public void activate(BackendPluginContext context, PluginDescriptor pluginDescriptor)
        {
            if (fail)
            {
                throw new IllegalStateException("broken on purpose");
            }
            contexts.put(descriptor.id(), context);
        }
    }
}
