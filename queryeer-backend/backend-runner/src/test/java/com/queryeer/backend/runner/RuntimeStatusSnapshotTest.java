package com.queryeer.backend.runner;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Assertions;
import org.junit.jupiter.api.Test;

import com.queryeer.backend.api.BackendPlugin;
import com.queryeer.backend.api.BackendPluginContext;
import com.queryeer.backend.api.PluginDescriptor;
import com.queryeer.backend.contract.runtime.RuntimePluginState;
import com.queryeer.backend.contract.runtime.RuntimePluginStatus;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;
import com.queryeer.backend.core.PluginRuntime;

class RuntimeStatusSnapshotTest
{
    @Test
    void statusCarriesThePluginDescriptor()
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin(new PluginDescriptor("queryengine.jdbc.dialect.postgres", "PostgreSQL JDBC Dialect", "0.1.0", List.of("queryengine.jdbc"), List.of("queryengine.jdbc.dialect.postgres"),
                List.of("queryengine.jdbc.connection"), Map.of(), List.of("queryengine.sql.parser"))));

        RuntimeStatusResult result = BackendRunnerModule.runtimeStatusSnapshot(runtime, List.of());

        Assertions.assertEquals(List.of(new RuntimePluginStatus("queryengine.jdbc.dialect.postgres", RuntimePluginState.LOADED, "Registered", "PostgreSQL JDBC Dialect", "0.1.0",
                List.of("queryengine.jdbc"), List.of("queryengine.sql.parser"), List.of("queryengine.jdbc.dialect.postgres"), List.of("queryengine.jdbc.connection"))), result.pluginStatuses());
        Assertions.assertEquals(List.of("queryengine.jdbc.dialect.postgres"), result.providedCapabilities());
    }

    @Test
    void descriptorListsThatAreMissingBecomeEmpty()
    {
        PluginRuntime runtime = new PluginRuntime();
        runtime.register(plugin(new PluginDescriptor("plugin.bare", "Bare", "1.0.0", null, null, null)));

        RuntimePluginStatus status = BackendRunnerModule.runtimeStatusSnapshot(runtime, List.of())
                .pluginStatuses()
                .get(0);

        Assertions.assertEquals(List.of(), status.dependencies());
        Assertions.assertEquals(List.of(), status.providesCapabilities());
        Assertions.assertEquals(List.of(), status.requiredCapabilities());
    }

    @Test
    void discoveryFailuresHaveNoDescriptor()
    {
        RuntimeStatusResult result = BackendRunnerModule.runtimeStatusSnapshot(new PluginRuntime(),
                List.of(new PluginDiscoveryService.DiscoveryFailure("plugin.broken", Path.of("broken"), "No plugin.json")));

        Assertions.assertEquals(List.of(new RuntimePluginStatus("plugin.broken", RuntimePluginState.FAILED, "No plugin.json")), result.pluginStatuses());
    }

    private static BackendPlugin plugin(PluginDescriptor descriptor)
    {
        return new BackendPlugin()
        {
            @Override
            public PluginDescriptor descriptor()
            {
                return descriptor;
            }

            @Override
            public void activate(BackendPluginContext context, PluginDescriptor activatedDescriptor)
            {
            }
        };
    }
}
