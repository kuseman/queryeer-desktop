package com.queryeer.backend.runner;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.queryeer.backend.contract.runtime.RuntimePluginState;
import com.queryeer.backend.contract.runtime.RuntimePluginStatus;
import com.queryeer.backend.contract.runtime.RuntimeStatusResult;
import com.queryeer.backend.core.BackendPlatformServices;
import com.queryeer.backend.core.PluginRuntime;
import com.queryeer.backend.core.PluginRuntimeStatus;
import com.queryeer.backend.plugin.jdbc.JdbcBackendPlugin;
import com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderBackendPlugin;
import com.queryeer.backend.transport.stdio.StdioTransportModule;

public final class BackendRunnerModule
{
    private static final String STARTED_AT = Instant.now()
            .toString();
    private static final String RUN_ID = UUID.randomUUID()
            .toString();

    public int run(InputStream input, OutputStream output)
    {
        int exitCode = 0;
        BackendPlatformServices services = BackendPlatformServices.defaultServices();
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
        objectMapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        PluginDiscoveryService discoveryService = new PluginDiscoveryService(objectMapper, services);

        PluginRuntime runtime = new PluginRuntime();
        List<DiscoveredPlugin> discoveredPlugins = discoverPlugins(discoveryService);
        for (DiscoveredPlugin discovered : discoveredPlugins)
        {
            runtime.register(discovered.plugin());
        }

        try
        {
            runtime.activateAll(services.pluginContext());
            logRuntimeSummary(services, runtime, discoveredPlugins);
        }
        catch (Exception e)
        {
            throw new IllegalStateException("Failed to activate backend plugins", e);
        }

        long startedAt = System.currentTimeMillis();
        StdioTransportModule.RunningTransport transportServer = new StdioTransportModule().create(input, output, objectMapper, services.queryEngines(), services.fileRegistryView(),
                () -> runtimeStatusSnapshot(runtime), startedAt);
        System.err.println(withCorrelation("Queryeer backend runner started (stdio mode).", null));
        try
        {
            transportServer.start();
        }
        catch (IOException e)
        {
            if (!transportServer.isStopped())
            {
                exitCode = 1;
                throw new IllegalStateException("Failed to start stdio transport", e);
            }
        }
        catch (Throwable t)
        {
            exitCode = 1;
            services.logger()
                    .error(withCorrelation("Unhandled stdio transport failure", null), t);
        }
        finally
        {
            try
            {
                runtime.deactivateAll();
            }
            catch (Exception e)
            {
                exitCode = 1;
                services.logger()
                        .error(withCorrelation("Failed to deactivate backend plugins", null), e);
            }
            PluginResourceCloser.closeClassLoaders(discoveredPlugins, services.logger());
        }
        return exitCode;
    }

    private List<DiscoveredPlugin> discoverPlugins(PluginDiscoveryService discoveryService)
    {
        Optional<String> explicitPath = resolvePluginPath();
        if (explicitPath.isPresent())
        {
            PluginDiscoveryService.DiscoveryResult discovered = discoveryService.discoverFromPath(explicitPath.get());
            return discovered.backendPlugins();
        }

        List<DiscoveredPlugin> builtins = new ArrayList<>();
        builtins.add(new DiscoveredPlugin(new PluginManifest(1, "query.payloadbuilder", "Payloadbuilder Query Engine", "0.1.0",
                new PluginManifest.BackendTarget("com.queryeer.backend.plugin.payloadbuilder.PayloadbuilderBackendPlugin", null, null, "17"), null, List.of(),
                List.of("queryengine.execute", "engine.invoke"), List.of(), null, null), new PayloadbuilderBackendPlugin(), null, false, null));
        builtins.add(new DiscoveredPlugin(new PluginManifest(1, "query.jdbc", "JDBC Query Engine", "0.1.0",
                new PluginManifest.BackendTarget("com.queryeer.backend.plugin.jdbc.JdbcBackendPlugin", null, null, "17"), null, List.of(), List.of("queryengine.execute"), List.of(), null, null),
                new JdbcBackendPlugin(), null, false, null));
        return builtins;
    }

    private Optional<String> resolvePluginPath()
    {
        String fromProperty = System.getProperty("queryeer.plugins.path");
        if (fromProperty != null
                && !fromProperty.isBlank())
        {
            return Optional.of(fromProperty);
        }

        String fromEnv = System.getenv("QUERYEER_PLUGINS_PATH");
        if (fromEnv != null
                && !fromEnv.isBlank())
        {
            return Optional.of(fromEnv);
        }

        return Optional.empty();
    }

    private RuntimeStatusResult runtimeStatusSnapshot(PluginRuntime runtime)
    {
        List<PluginRuntimeStatus> coreStatuses = runtime.statuses();
        List<String> pluginOrder = runtime.plugins()
                .stream()
                .map(plugin -> plugin.descriptor()
                        .id())
                .toList();
        List<RuntimePluginStatus> statuses = new ArrayList<>();
        Set<String> providedCapabilities = new LinkedHashSet<>();
        for (String pluginId : pluginOrder)
        {
            PluginRuntimeStatus status = coreStatuses.stream()
                    .filter(candidate -> candidate.pluginId()
                            .equals(pluginId))
                    .findFirst()
                    .orElse(new PluginRuntimeStatus(pluginId, com.queryeer.backend.core.PluginRuntimeState.LOADED, "Registered"));
            statuses.add(new RuntimePluginStatus(status.pluginId(), toContractState(status.state()), status.reason()));
            runtime.plugins()
                    .stream()
                    .filter(plugin -> plugin.descriptor()
                            .id()
                            .equals(status.pluginId()))
                    .findFirst()
                    .ifPresent(plugin -> providedCapabilities.addAll(plugin.descriptor()
                            .providesCapabilities()));
        }

        return new RuntimeStatusResult(STARTED_AT, statuses, runtime.activatedPluginIds(), new ArrayList<>(providedCapabilities));
    }

    private RuntimePluginState toContractState(com.queryeer.backend.core.PluginRuntimeState state)
    {
        return RuntimePluginState.valueOf(state.name());
    }

    private void logRuntimeSummary(BackendPlatformServices services, PluginRuntime runtime, List<DiscoveredPlugin> discoveredPlugins)
    {
        List<PluginRuntimeStatus> statuses = runtime.statuses();
        long activated = statuses.stream()
                .filter(status -> status.state() == com.queryeer.backend.core.PluginRuntimeState.ACTIVATED)
                .count();
        long skipped = statuses.stream()
                .filter(status -> status.state() == com.queryeer.backend.core.PluginRuntimeState.SKIPPED)
                .count();
        long failed = statuses.stream()
                .filter(status -> status.state() == com.queryeer.backend.core.PluginRuntimeState.FAILED)
                .count();

        services.logger()
                .info(withCorrelation("Runtime startup summary: activated=" + activated + ", skipped=" + skipped + ", failed=" + failed, null));

        for (DiscoveredPlugin discovered : discoveredPlugins)
        {
            String source = discovered.source() == null ? "builtin"
                    : discovered.source()
                            .toString();
            services.logger()
                    .info(withCorrelation("Discovered plugin " + discovered.manifest()
                            .id() + " from " + source + ", isolatedClassLoader=" + discovered.isolatedClassLoader(), null));
        }

        for (PluginRuntimeStatus status : statuses)
        {
            services.logger()
                    .info(withCorrelation("Plugin status " + status.pluginId()
                                          + " -> "
                                          + status.state()
                                          + ""
                                          + (status.reason() == null ? ""
                                                  : " (" + status.reason() + ")"),
                            status.pluginId()));
        }
    }

    private String withCorrelation(String message, String pluginId)
    {
        String pluginSegment = pluginId == null ? ""
                : ",pluginId=" + pluginId;
        return "[runId=" + RUN_ID + pluginSegment + "] " + sanitizeLogMessage(message);
    }

    private String sanitizeLogMessage(String message)
    {
        return message.replaceAll("(?i)(password|secret|token|credential|authorization)\\s*[:=]\\s*[^\\s,;]+", "$1=[REDACTED]");
    }
}
