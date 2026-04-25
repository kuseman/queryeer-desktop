package com.queryeer.backend.core;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.api.QueryEngineProvider;

class PluginRuntimeArchitectureTest
{
    @Test
    void activateAllInjectsContextServicesAndRegistersEngines() throws Exception
    {
        BackendPlatformServices services = BackendPlatformServices.defaultServices(java.util.Map.of("env", "test"));

        PluginRuntime runtime = new PluginRuntime();
        runtime.register(new RecordingPlugin("plugin.one", "engine.one"));
        runtime.register(new RecordingPlugin("plugin.two", "engine.two"));

        runtime.activateAll(services.pluginContext());

        Assertions.assertEquals(2, services.queryEngineRegistryView()
                .size());
        Assertions.assertEquals("test", services.config()
                .get("env"));
        Assertions.assertEquals(2, RecordingPlugin.activationOrder.size());
    }

    @Test
    void deactivateAllRunsInReverseActivationOrder() throws Exception
    {
        RecordingPlugin.activationOrder.clear();
        RecordingPlugin.deactivationOrder.clear();

        BackendPlatformServices services = BackendPlatformServices.defaultServices();
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(new RecordingPlugin("plugin.one", "engine.one"));
        runtime.register(new RecordingPlugin("plugin.two", "engine.two"));

        runtime.activateAll(services.pluginContext());
        runtime.deactivateAll();

        Assertions.assertEquals(List.of("plugin.one", "plugin.two"), RecordingPlugin.activationOrder);
        Assertions.assertEquals(List.of("plugin.two", "plugin.one"), RecordingPlugin.deactivationOrder);
    }

    @Test
    void skipsPluginWithMissingDependency() throws Exception
    {
        BackendPlatformServices services = BackendPlatformServices.defaultServices();
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(new RecordingPlugin("plugin.dep", "engine.dep", List.of("plugin.missing"), List.of(), false));

        runtime.activateAll(services.pluginContext());

        PluginRuntimeStatus status = findStatus(runtime.statuses(), "plugin.dep");
        Assertions.assertEquals(PluginRuntimeState.SKIPPED, status.state());
        Assertions.assertTrue(status.reason()
                .contains("Missing dependency"));
    }

    @Test
    void skipsPluginWithMissingRequiredCapability() throws Exception
    {
        BackendPlatformServices services = BackendPlatformServices.defaultServices();
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(new RecordingPlugin("plugin.cap", "engine.cap", List.of(), List.of("cap.missing"), false));

        runtime.activateAll(services.pluginContext());

        PluginRuntimeStatus status = findStatus(runtime.statuses(), "plugin.cap");
        Assertions.assertEquals(PluginRuntimeState.SKIPPED, status.state());
        Assertions.assertTrue(status.reason()
                .contains("Missing required capability"));
    }

    @Test
    void dependencyOrderActivatesDependencyFirst() throws Exception
    {
        RecordingPlugin.activationOrder.clear();

        BackendPlatformServices services = BackendPlatformServices.defaultServices();
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(new RecordingPlugin("plugin.consumer", "engine.consumer", List.of("plugin.provider"), List.of("cap.provider"), false));
        runtime.register(new RecordingPlugin("plugin.provider", "engine.provider", List.of(), List.of(), false, List.of("cap.provider")));

        runtime.activateAll(services.pluginContext());

        Assertions.assertEquals(List.of("plugin.provider", "plugin.consumer"), RecordingPlugin.activationOrder);
    }

    @Test
    void marksFailedWhenActivationThrowsAndContinues() throws Exception
    {
        BackendPlatformServices services = BackendPlatformServices.defaultServices();
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(new RecordingPlugin("plugin.fail", "engine.fail", List.of(), List.of(), true));
        runtime.register(new RecordingPlugin("plugin.ok", "engine.ok"));

        runtime.activateAll(services.pluginContext());

        PluginRuntimeStatus failed = findStatus(runtime.statuses(), "plugin.fail");
        PluginRuntimeStatus ok = findStatus(runtime.statuses(), "plugin.ok");

        Assertions.assertEquals(PluginRuntimeState.FAILED, failed.state());
        Assertions.assertEquals(PluginRuntimeState.ACTIVATED, ok.state());
    }

    @Test
    void detectsDependencyCycle()
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(new RecordingPlugin("plugin.one", "engine.one", List.of("plugin.two"), List.of(), false));
        runtime.register(new RecordingPlugin("plugin.two", "engine.two", List.of("plugin.one"), List.of(), false));

        IllegalStateException error = Assertions.assertThrows(IllegalStateException.class, () -> runtime.activateAll(BackendPlatformServices.defaultServices()
                .pluginContext()));
        Assertions.assertTrue(error.getMessage()
                .contains("cycle"));
    }

    private PluginRuntimeStatus findStatus(List<PluginRuntimeStatus> statuses, String pluginId)
    {
        return statuses.stream()
                .filter((status) -> status.pluginId()
                        .equals(pluginId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("Missing status for plugin: " + pluginId));
    }

    private static final class RecordingPlugin implements BackendPlugin
    {
        private static final List<String> activationOrder = new ArrayList<>();
        private static final List<String> deactivationOrder = new ArrayList<>();

        private final String id;
        private final String engineId;
        private final List<String> dependencies;
        private final List<String> requiredCapabilities;
        private final boolean failOnActivate;
        private final List<String> providedCapabilities;

        private RecordingPlugin(String id, String engineId)
        {
            this(id, engineId, List.of(), List.of(), false);
        }

        private RecordingPlugin(String id, String engineId, List<String> dependencies, List<String> requiredCapabilities, boolean failOnActivate)
        {
            this(id, engineId, dependencies, requiredCapabilities, failOnActivate, List.of("query.execute"));
        }

        private RecordingPlugin(String id, String engineId, List<String> dependencies, List<String> requiredCapabilities, boolean failOnActivate, List<String> providedCapabilities)
        {
            this.id = id;
            this.engineId = engineId;
            this.dependencies = dependencies;
            this.requiredCapabilities = requiredCapabilities;
            this.failOnActivate = failOnActivate;
            this.providedCapabilities = providedCapabilities;
        }

        @Override
        public PluginDescriptor descriptor()
        {
            return new PluginDescriptor(id, id, "0.1.0", dependencies, providedCapabilities, requiredCapabilities);
        }

        @Override
        public void activate(BackendPluginContext context)
        {
            if (failOnActivate)
            {
                throw new IllegalStateException("Activation failed: " + id);
            }
            activationOrder.add(id);
            context.queryEngines()
                    .register(new QueryEngineProvider()
                    {
                        @Override
                        public String engineId()
                        {
                            return engineId;
                        }

                        @Override
                        public void execute(String queryExecutionId, String text, com.queryeer.backend.api.QueryPublisher publisher)
                        {
                        }

                        @Override
                        public void cancel(String queryExecutionId)
                        {
                        }
                    });
        }

        @Override
        public void deactivate()
        {
            deactivationOrder.add(id);
        }
    }
}
